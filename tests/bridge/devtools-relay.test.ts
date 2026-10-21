import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelRelay, installDevtoolsRelay, installPanelVisibilityRelay, type RelayRuntime, type RelayMessageListener } from '../../src/bridge/devtools-relay';

const extension = vi.hoisted(() => ({
  nativeEval: vi.fn(),
  sendMessage: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'extension-id',
      getURL: (path: string) => `safari-web-extension://extension-id/${path}`,
      sendMessage: extension.sendMessage,
      onMessage: { addListener: extension.addListener, removeListener: extension.removeListener },
    },
    devtools: { inspectedWindow: { eval: extension.nativeEval, tabId: -1 } },
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('panel evaluation entrypoint', () => {
  it('evaluates through its devtools session without calling native eval in the panel', async () => {
    vi.stubGlobal('location', { href: 'safari-web-extension://extension-id/panel.html?session=one' });
    extension.nativeEval.mockRejectedValue(new Error('Panel process must not call native eval'));
    extension.sendMessage.mockResolvedValue({ kind: 'sw-inspector/evaluated', session: 'one', result: 2, exception: null });
    const { evaluateInspectedWindow } = await import('../../src/bridge/eval-window');

    await expect(evaluateInspectedWindow('1 + 1')).resolves.toEqual([2, undefined]);
    expect(extension.nativeEval).not.toHaveBeenCalled();
    expect(extension.sendMessage).toHaveBeenCalledWith({ kind: 'sw-inspector/evaluate', session: 'one', source: '1 + 1' });
  });
});

function event<T extends (...args: never[]) => unknown>() {
  const listeners = new Set<T>();
  return {
    listeners,
    addListener: (listener: T) => { listeners.add(listener); },
    removeListener: (listener: T) => { listeners.delete(listener); },
  };
}

function messageBus() {
  const endpoints: { runtime: RelayRuntime; url: string; messages: ReturnType<typeof event<RelayMessageListener>> }[] = [];
  return (path: string) => {
    const messages = event<RelayMessageListener>();
    const url = `safari-web-extension://extension-id/${path}`;
    const runtime: RelayRuntime = {
      id: 'extension-id',
      getURL: (resource) => `safari-web-extension://extension-id/${resource}`,
      onMessage: messages,
      sendMessage: (message) => new Promise((resolve) => {
        let pending = false;
        const reply = (value: unknown) => resolve(JSON.parse(JSON.stringify(value)));
        for (const endpoint of endpoints) {
          if (endpoint.runtime === runtime) continue;
          for (const listener of endpoint.messages.listeners) {
            if (listener(message, { id: runtime.id, url }, reply) === true) pending = true;
          }
        }
        if (!pending) resolve(undefined);
      }),
    };
    const endpoint = { runtime, url, messages };
    endpoints.push(endpoint);
    return endpoint;
  };
}

function host(endpoint: ReturnType<ReturnType<typeof messageBus>>, session: string, evaluate: (source: string) => Promise<unknown>) {
  const navigation = event<() => void>();
  const dispose = installDevtoolsRelay(endpoint.runtime, {
    inspectedWindow: { eval: evaluate },
    network: { onNavigated: navigation },
  }, session);
  return { navigation, dispose };
}

describe('devtools relay', () => {
  it('keeps two inspected sessions isolated without relying on tab identifiers', async () => {
    const endpoint = messageBus();
    const firstEval = vi.fn(async () => ['first', undefined]);
    const secondEval = vi.fn(async () => ['second', undefined]);
    host(endpoint('devtools.html'), 'one', firstEval);
    host(endpoint('devtools.html'), 'two', secondEval);
    const first = endpoint('panel.html?session=one');
    const second = endpoint('panel.html?session=two');

    await expect(createPanelRelay(first.runtime, first.url).evaluate('first source')).resolves.toEqual(['first', undefined]);
    await expect(createPanelRelay(second.runtime, second.url).evaluate('second source')).resolves.toEqual(['second', undefined]);
    expect(firstEval).toHaveBeenCalledExactlyOnceWith('first source');
    expect(secondEval).toHaveBeenCalledExactlyOnceWith('second source');
  });

  it.each([
    [2, [2, undefined]],
    [[2, undefined], [2, undefined]],
    [[null, null], [null, undefined]],
    [undefined, [null, undefined]],
    [[undefined, { isException: true, value: 'Denied' }], [null, { isException: true, value: 'Denied' }]],
  ])('normalizes native result %j across JSON message serialization', async (raw, expected) => {
    const endpoint = messageBus();
    host(endpoint('devtools.html'), 'one', async () => raw);
    const panel = endpoint('panel.html?session=one');
    await expect(createPanelRelay(panel.runtime, panel.url).evaluate('source')).resolves.toEqual(expected);
  });

  it('returns a typed exception for a rejected native call', async () => {
    const endpoint = messageBus();
    host(endpoint('devtools.html'), 'one', async () => { throw new Error('Safari denied access'); });
    const panel = endpoint('panel.html?session=one');
    await expect(createPanelRelay(panel.runtime, panel.url).evaluate('source')).resolves.toEqual([
      null, { isException: true, value: 'Safari denied access' },
    ]);
  });

  it.each([
    { id: 'another-extension', url: 'safari-web-extension://extension-id/panel.html?session=one', session: 'one' },
    { id: 'extension-id', url: 'https://extension-id/panel.html?session=one', session: 'one' },
    { id: 'extension-id', url: 'safari-web-extension://extension-id/other.html?session=one', session: 'one' },
    { id: 'extension-id', url: 'safari-web-extension://extension-id/panel.html?session=two', session: 'one' },
    { id: 'extension-id', url: 'safari-web-extension://extension-id/panel.html?session=one', session: 'two' },
  ])('ignores requests outside the matching panel/session: %j', ({ id, url, session }) => {
    const endpoint = messageBus()('devtools.html');
    const nativeEval = vi.fn(async () => 2);
    host(endpoint, 'one', nativeEval);
    const respond = vi.fn();
    const [listener] = endpoint.messages.listeners;
    expect(listener({ kind: 'sw-inspector/evaluate', session, source: '1 + 1' }, { id, url }, respond)).toBeUndefined();
    expect(nativeEval).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('rejects a non-string expression without executing it', async () => {
    const endpoint = messageBus();
    const nativeEval = vi.fn(async () => 2);
    host(endpoint('devtools.html'), 'one', nativeEval);
    const panel = endpoint('panel.html?session=one');
    await expect(panel.runtime.sendMessage({ kind: 'sw-inspector/evaluate', session: 'one', source: { injected: true } })).resolves.toMatchObject({
      exception: { isException: true },
    });
    expect(nativeEval).not.toHaveBeenCalled();
  });

  it('forwards navigation only to its session and removes both subscriptions', async () => {
    const endpoint = messageBus();
    const devtools = endpoint('devtools.html');
    const firstHost = host(devtools, 'one', async () => 2);
    const first = endpoint('panel.html?session=one');
    const second = endpoint('panel.html?session=two');
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribe = createPanelRelay(first.runtime, first.url).subscribeNavigation(firstListener);
    const unsubscribeOther = createPanelRelay(second.runtime, second.url).subscribeNavigation(secondListener);
    for (const listener of firstHost.navigation.listeners) listener();
    await Promise.resolve();
    expect(firstListener).toHaveBeenCalledOnce();
    expect(secondListener).not.toHaveBeenCalled();

    await first.runtime.sendMessage({ kind: 'sw-inspector/navigated', session: 'two' });
    expect(secondListener).not.toHaveBeenCalled();
    unsubscribe();
    for (const listener of firstHost.navigation.listeners) listener();
    await Promise.resolve();
    expect(firstListener).toHaveBeenCalledOnce();
    unsubscribeOther();
    firstHost.dispose();
    expect(first.messages.listeners.size).toBe(0);
    expect(second.messages.listeners.size).toBe(0);
    expect(firstHost.navigation.listeners.size).toBe(0);
    expect(devtools.messages.listeners.size).toBe(0);
  });

  it.each([
    undefined,
    { kind: 'sw-inspector/evaluated', session: 'other', result: 2, exception: null },
    { kind: 'sw-inspector/evaluated', session: 'one', result: 2, exception: 'unexpected' },
    { kind: 'sw-inspector/evaluated', session: 'one', exception: null },
  ])('fails closed for a missing or malformed reply: %j', async (reply) => {
    const panel = messageBus()('panel.html?session=one');
    panel.runtime.sendMessage = async () => reply;
    await expect(createPanelRelay(panel.runtime, panel.url).evaluate('source')).resolves.toMatchObject([
      undefined, { isException: true },
    ]);
  });

  it('fails closed when no session is present, without sending a request', async () => {
    const panel = messageBus()('panel.html');
    const send = vi.spyOn(panel.runtime, 'sendMessage');
    await expect(createPanelRelay(panel.runtime, panel.url).evaluate('source')).resolves.toMatchObject([
      undefined, { isException: true },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it('converts a messaging failure to an exception and clears its timer', async () => {
    vi.useFakeTimers();
    const panel = messageBus()('panel.html?session=one');
    panel.runtime.sendMessage = async () => { throw new Error('No receiving devtools page'); };
    await expect(createPanelRelay(panel.runtime, panel.url).evaluate('source')).resolves.toEqual([
      undefined, { isException: true, value: 'No receiving devtools page' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a hung runtime request and ignores its late reply', async () => {
    vi.useFakeTimers();
    const panel = messageBus()('panel.html?session=one');
    let reply!: (value: unknown) => void;
    panel.runtime.sendMessage = () => new Promise((resolve) => { reply = resolve; });
    const pending = createPanelRelay(panel.runtime, panel.url, 20).evaluate('source');
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toMatchObject([undefined, { isException: true, value: expect.stringMatching(/timed out/i) }]);
    reply({ kind: 'sw-inspector/evaluated', session: 'one', result: 2, exception: null });
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});


describe('panel visibility relay', () => {
  it('refreshes only on a real return, isolates sessions and cleans up', async () => {
    const endpoint = messageBus();
    const devtools = endpoint('devtools.html');
    const panel = endpoint('panel.html?session=one');
    const other = endpoint('panel.html?session=two');
    const onShown = event<() => void>();
    const onHidden = event<() => void>();
    const dispose = installPanelVisibilityRelay(devtools.runtime, { onShown, onHidden }, 'one');
    const refresh = vi.fn();
    const otherRefresh = vi.fn();
    const unsubscribe = createPanelRelay(panel.runtime, panel.url).subscribePanelReturn(refresh);
    const unsubscribeOther = createPanelRelay(other.runtime, other.url).subscribePanelReturn(otherRefresh);
    const show = () => { for (const listener of onShown.listeners) listener(); };
    const hide = () => { for (const listener of onHidden.listeners) listener(); };
    show(); show(); hide();
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    show(); show();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    expect(otherRefresh).not.toHaveBeenCalled();
    await panel.runtime.sendMessage({ kind: 'sw-inspector/panel-returned', session: 'two' });
    expect(otherRefresh).not.toHaveBeenCalled();
    unsubscribe(); unsubscribeOther(); dispose();
    hide(); show();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    expect(onShown.listeners.size).toBe(0);
    expect(onHidden.listeners.size).toBe(0);
    expect(panel.messages.listeners.size).toBe(0);
  });
});


it('rejects forged return notifications and cancels queued notifications on disposal', async () => {
  const endpoint = messageBus();
  const devtools = endpoint('devtools.html');
  const panel = endpoint('panel.html?session=one');
  const refresh = vi.fn();
  const unsubscribe = createPanelRelay(panel.runtime, panel.url).subscribePanelReturn(refresh);
  const [listener] = panel.messages.listeners;
  for (const sender of [
    { id: 'wrong', url: devtools.url },
    { id: 'extension-id', url: panel.url },
    { id: 'extension-id', url: 'https://extension-id/devtools.html' },
  ]) listener({ kind: 'sw-inspector/panel-returned', session: 'one', epoch: 1 }, sender, () => {});
  expect(refresh).not.toHaveBeenCalled();
  const onShown = event<() => void>();
  const onHidden = event<() => void>();
  const dispose = installPanelVisibilityRelay(devtools.runtime, { onShown, onHidden }, 'one');
  for (const handler of onShown.listeners) handler();
  for (const handler of onHidden.listeners) handler();
  for (const handler of onShown.listeners) handler();
  dispose();
  await Promise.resolve();
  expect(refresh).not.toHaveBeenCalled();
  unsubscribe();
});


it('recognizes the first return when the initial show preceded listener attachment', async () => {
  const endpoint = messageBus();
  const devtools = endpoint('devtools.html');
  const panel = endpoint('panel.html?session=one');
  const refresh = vi.fn();
  const unsubscribe = createPanelRelay(panel.runtime, panel.url).subscribePanelReturn(refresh);
  const onShown = event<() => void>();
  const onHidden = event<() => void>();
  const dispose = installPanelVisibilityRelay(devtools.runtime, { onShown, onHidden }, 'one');
  // Panel creation can finish after its first native show; hide is the first observed event.
  for (const listener of onHidden.listeners) listener();
  await Promise.resolve();
  expect(refresh).not.toHaveBeenCalled();
  for (const listener of onShown.listeners) listener();
  for (const listener of onShown.listeners) listener();
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledOnce();
  dispose();
  unsubscribe();
});


it('removes partially attached visibility listeners if attachment fails', () => {
  const endpoint = messageBus()('devtools.html');
  const onShown = event<() => void>();
  const dispose = installPanelVisibilityRelay(endpoint.runtime, {
    onShown,
    onHidden: { addListener: () => { throw new Error('native attach failed'); }, removeListener: () => {} },
  }, 'one');
  expect(onShown.listeners.size).toBe(0);
  dispose();
});

it('uses native hide epochs to gate and deduplicate focused document activation', async () => {
  const endpoint = messageBus();
  const devtools = endpoint('devtools.html');
  const panel = endpoint('panel.html?session=one');
  const lifecycle = { hiddenEpoch: 0 };
  const disposeHost = installDevtoolsRelay(devtools.runtime, {
    inspectedWindow: { eval: vi.fn() }, network: { onNavigated: event<() => void>() },
  }, 'one', lifecycle);
  const onShown = event<() => void>();
  const onHidden = event<() => void>();
  const disposeVisibility = installPanelVisibilityRelay(devtools.runtime, { onShown, onHidden }, 'one', lifecycle);
  const relay = createPanelRelay(panel.runtime, panel.url);
  const refresh = vi.fn();
  const unsubscribe = relay.subscribePanelReturn(refresh);
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).not.toHaveBeenCalled();
  for (const hide of onHidden.listeners) hide();
  await relay.requestPanelActivation(refresh, () => true);
  await relay.requestPanelActivation(refresh, () => true);
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-returned', session: 'one', epoch: 1 });
  expect(refresh).toHaveBeenCalledOnce();
  for (const hide of onHidden.listeners) hide();
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-returned', session: 'one', epoch: 2 });
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).toHaveBeenCalledTimes(2);
  unsubscribe(); disposeVisibility(); disposeHost();
});

it('rejects late document activation after blur, disposal, or failed focus recheck', async () => {
  const panel = messageBus()('panel.html?session=one');
  let reply!: (value: unknown) => void;
  panel.runtime.sendMessage = () => new Promise(resolve => { reply = resolve; });
  const relay = createPanelRelay(panel.runtime, panel.url);
  const refresh = vi.fn();
  let focused = true;
  const pending = relay.requestPanelActivation(refresh, () => focused);
  await Promise.resolve(); await Promise.resolve();
  focused = false;
  reply({ kind: 'sw-inspector/panel-activation', session: 'one', epoch: 1 });
  await pending;
  expect(refresh).not.toHaveBeenCalled();
  focused = true;
  const next = relay.requestPanelActivation(refresh, () => focused);
  await Promise.resolve(); await Promise.resolve();
  relay.cancelPanelActivation();
  reply({ kind: 'sw-inspector/panel-activation', session: 'one', epoch: 1 });
  await next;
  expect(refresh).not.toHaveBeenCalled();
  panel.runtime.sendMessage = async () => ({ kind: 'sw-inspector/panel-activation', session: 'one', epoch: 1 });
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).toHaveBeenCalledOnce();
});


it('baselines an already-opened host epoch on remount without duplicating its initial snapshot', async () => {
  const panel = messageBus()('panel.html?session=one');
  let epoch = 4;
  panel.runtime.sendMessage = async () => ({ kind: 'sw-inspector/panel-activation', session: 'one', epoch });
  const relay = createPanelRelay(panel.runtime, panel.url);
  const refresh = vi.fn();
  const initialization = relay.initializePanelActivation();
  const focus = relay.requestPanelActivation(refresh, () => true);
  await initialization; await focus;
  expect(refresh).not.toHaveBeenCalled();
  epoch = 5;
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).toHaveBeenCalledOnce();
});

it.each([
  { kind: 'wrong', session: 'one', epoch: 1 },
  { kind: 'sw-inspector/panel-activation', session: 'wrong', epoch: 1 },
  { kind: 'sw-inspector/panel-activation', session: 'one', epoch: -1 },
  { kind: 'sw-inspector/panel-activation', session: 'one', epoch: 1.5 },
])('fails closed for malformed activation replies: %j', async response => {
  const panel = messageBus()('panel.html?session=one');
  panel.runtime.sendMessage = async () => response;
  const relay = createPanelRelay(panel.runtime, panel.url);
  const refresh = vi.fn();
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).not.toHaveBeenCalled();
  panel.runtime.sendMessage = async () => ({ kind: 'sw-inspector/panel-activation', session: 'one', epoch: 1 });
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).toHaveBeenCalledOnce();
});

it('bounds a hung activation query without refreshing or consuming an epoch', async () => {
  vi.useFakeTimers();
  const panel = messageBus()('panel.html?session=one');
  panel.runtime.sendMessage = () => new Promise(() => {});
  const relay = createPanelRelay(panel.runtime, panel.url, 20);
  const refresh = vi.fn();
  const pending = relay.requestPanelActivation(refresh, () => true);
  await vi.advanceTimersByTimeAsync(20);
  await pending;
  expect(refresh).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});


it('recovers a failed mount baseline on a later activation without polling or a duplicate initial snapshot', async () => {
  const panel = messageBus()('panel.html?session=one');
  let fail = true;
  let epoch = 3;
  panel.runtime.sendMessage = async () => {
    if (fail) throw new Error('temporary unavailable');
    return { kind: 'sw-inspector/panel-activation', session: 'one', epoch };
  };
  const relay = createPanelRelay(panel.runtime, panel.url);
  const refresh = vi.fn();
  await relay.initializePanelActivation();
  fail = false;
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).not.toHaveBeenCalled();
  epoch = 4;
  await relay.requestPanelActivation(refresh, () => true);
  expect(refresh).toHaveBeenCalledOnce();
});


it('authenticates activation queries and returns only the epoch without native eval', async () => {
  const endpoint = messageBus();
  const devtools = endpoint('devtools.html');
  const panel = endpoint('panel.html?session=one');
  const nativeEval = vi.fn();
  const dispose = installDevtoolsRelay(devtools.runtime, {
    inspectedWindow: { eval: nativeEval }, network: { onNavigated: event<() => void>() },
  }, 'one', { hiddenEpoch: 2 });
  const [listener] = devtools.messages.listeners;
  const respond = vi.fn();
  for (const sender of [
    { id: 'wrong', url: panel.url },
    { id: 'extension-id', url: 'https://extension-id/panel.html?session=one' },
    { id: 'extension-id', url: 'safari-web-extension://extension-id/panel.html?session=wrong' },
  ]) expect(listener({ kind: 'sw-inspector/panel-activation', session: 'one' }, sender, respond)).toBeUndefined();
  expect(respond).not.toHaveBeenCalled();
  await expect(panel.runtime.sendMessage({ kind: 'sw-inspector/panel-activation', session: 'one' })).resolves.toEqual({ kind: 'sw-inspector/panel-activation', session: 'one', epoch: 2 });
  expect(nativeEval).not.toHaveBeenCalled();
  dispose();
});

it('authenticates hidden events without consuming return epoch and rejects delayed old hides', async () => {
  const endpoint = messageBus(); const devtools = endpoint('devtools.html'); const panel = endpoint('panel.html?session=one'); const other = endpoint('panel.html?session=two');
  const relay = createPanelRelay(panel.runtime, panel.url); const hidden = vi.fn(); const returned = vi.fn();
  const unsubscribe = relay.subscribePanelHidden(hidden); const unsubscribeReturn = relay.subscribePanelReturn(returned);
  const [listener] = panel.messages.listeners;
  for (const sender of [{ id: 'wrong', url: devtools.url }, { id: 'extension-id', url: panel.url }, { id: 'extension-id', url: 'https://extension-id/devtools.html' }]) listener({ kind: 'sw-inspector/panel-hidden', session: 'one', epoch: 1 }, sender, () => {});
  await other.runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session: 'one', epoch: 1 });
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session: 'two', epoch: 1 });
  for (const epoch of [-1, 0, 1.5, NaN, '1']) await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session: 'one', epoch });
  expect(hidden).not.toHaveBeenCalled();
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session: 'one', epoch: 1 });
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session: 'one', epoch: 1 }); expect(hidden).toHaveBeenCalledOnce();
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-returned', session: 'one', epoch: 1 }); expect(returned).toHaveBeenCalledOnce();
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-returned', session: 'one', epoch: 2 });
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session: 'one', epoch: 2 }); expect(hidden).toHaveBeenCalledOnce();
  await devtools.runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session: 'one', epoch: 3 }); expect(hidden).toHaveBeenCalledTimes(2);
  unsubscribe(); unsubscribeReturn(); expect(panel.messages.listeners.size).toBe(0);
});
it('emits native hidden signal and removes its listener on disposal', async () => {
  const endpoint = messageBus(); const devtools = endpoint('devtools.html'); const panel = endpoint('panel.html?session=one');
  const onShown = event<() => void>(); const onHidden = event<() => void>(); const hidden = vi.fn();
  const unsubscribe = createPanelRelay(panel.runtime, panel.url).subscribePanelHidden(hidden);
  const dispose = installPanelVisibilityRelay(devtools.runtime, { onShown, onHidden }, 'one');
  for (const listener of onHidden.listeners) listener(); await Promise.resolve(); expect(hidden).toHaveBeenCalledOnce();
  for (const listener of onHidden.listeners) listener(); dispose(); await Promise.resolve(); expect(hidden).toHaveBeenCalledOnce();
  unsubscribe(); expect(onHidden.listeners.size).toBe(0);
});
