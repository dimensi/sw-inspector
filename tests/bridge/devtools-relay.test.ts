import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelRelay, installDevtoolsRelay, type RelayRuntime, type RelayMessageListener } from '../../src/bridge/devtools-relay';

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
