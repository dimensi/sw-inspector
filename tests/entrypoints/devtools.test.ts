import { afterEach, describe, expect, it, vi } from 'vitest';

const extension = vi.hoisted(() => ({
  createPanel: vi.fn(),
  nativeEval: vi.fn(),
  addMessage: vi.fn(),
  removeMessage: vi.fn(),
  addNavigation: vi.fn(),
  removeNavigation: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'extension-id',
      getURL: (path: string) => `safari-web-extension://extension-id/${path}`,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: { addListener: extension.addMessage, removeListener: extension.removeMessage },
    },
    devtools: {
      panels: { create: extension.createPanel },
      inspectedWindow: { eval: extension.nativeEval },
      network: { onNavigated: { addListener: extension.addNavigation, removeListener: extension.removeNavigation } },
    },
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Safari DevTools entrypoint', () => {
  it('connects the relay before creating a panel with its own relative session URL', async () => {
    const order: string[] = [];
    extension.addMessage.mockImplementation(() => order.push('listener'));
    extension.createPanel.mockImplementation(() => { order.push('panel'); return Promise.resolve(); });
    extension.nativeEval.mockResolvedValue([2, undefined]);
    vi.stubGlobal('crypto', { randomUUID: () => 'session-one' });
    const onPageEvent = vi.fn();
    vi.stubGlobal('addEventListener', onPageEvent);

    await import('../../entrypoints/devtools/main');

    expect(order).toEqual(['listener', 'panel']);
    expect(extension.createPanel).toHaveBeenCalledWith('SW Inspector', '/icons/16.png', 'panel.html?session=session-one');
    expect(extension.nativeEval).not.toHaveBeenCalled();

    const respond = vi.fn();
    const listener = extension.addMessage.mock.calls[0][0];
    expect(listener({ kind: 'sw-inspector/evaluate', session: 'session-one', source: '1 + 1' }, {
      id: 'extension-id', url: 'safari-web-extension://extension-id/panel.html?session=session-one',
    }, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({
      kind: 'sw-inspector/evaluated', session: 'session-one', result: 2, exception: null,
    }));

    const [eventName, dispose] = onPageEvent.mock.calls[0];
    expect(eventName).toBe('pagehide');
    dispose();
    expect(extension.removeMessage).toHaveBeenCalledWith(listener);
    expect(extension.removeNavigation).toHaveBeenCalledWith(extension.addNavigation.mock.calls[0][0]);
  });
});
