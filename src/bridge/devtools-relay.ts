import type { EvalException, EvalFn } from './transport';

type Sender = { id?: string; url?: string };
export type RelayMessageListener = (message: unknown, sender: Sender, respond: (response: unknown) => void) => true | undefined;

export type RelayRuntime = {
  id: string;
  getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: {
    addListener(listener: RelayMessageListener): void;
    removeListener(listener: RelayMessageListener): void;
  };
};

type Devtools = {
  inspectedWindow: { eval(source: string): Promise<unknown> };
  network: { onNavigated: { addListener(listener: () => void): void; removeListener(listener: () => void): void } };
};

const exception = (error: unknown): EvalException => ({
  isException: true,
  value: error instanceof Error ? error.message : String(error),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isException(value: unknown): value is EvalException {
  return isRecord(value)
    && (value.isException === undefined || typeof value.isException === 'boolean')
    && (value.isError === undefined || typeof value.isError === 'boolean')
    && (value.value === undefined || typeof value.value === 'string')
    && (value.code === undefined || typeof value.code === 'string');
}

function matchesSender(runtime: RelayRuntime, sender: Sender, page: string, session?: string): boolean {
  if (sender.id !== runtime.id || !sender.url) return false;
  try {
    const actual = new URL(sender.url);
    const expected = new URL(runtime.getURL(page));
    // Custom extension URL schemes can have origin "null"; compare their parts.
    return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname
      && (session === undefined || actual.searchParams.get('session') === session);
  } catch {
    return false;
  }
}

export function installDevtoolsRelay(runtime: RelayRuntime, devtools: Devtools, session: string): () => void {
  async function evaluate(source: unknown) {
    let result: unknown = null;
    let error: EvalException | null = null;
    try {
      if (typeof source !== 'string') throw new Error('Invalid inspected-page expression');
      const raw = await devtools.inspectedWindow.eval(source);
      if (Array.isArray(raw) && raw.length === 2) {
        result = raw[0] ?? null;
        if (raw[1] != null && !isException(raw[1])) throw new Error('Invalid native evaluation exception');
        error = raw[1] ?? null;
      } else {
        result = raw ?? null;
      }
    } catch (cause) {
      error = exception(cause);
    }
    return { kind: 'sw-inspector/evaluated', session, result, exception: error };
  }

  const onMessage: RelayMessageListener = (message, sender, respond) => {
    if (!isRecord(message) || message.kind !== 'sw-inspector/evaluate' || message.session !== session
      || !matchesSender(runtime, sender, 'panel.html', session)) return;
    void evaluate(message.source).then(respond).catch(() => { /* The panel may have closed. */ });
    return true;
  };
  const onNavigated = () => {
    void Promise.resolve().then(() => runtime.sendMessage({ kind: 'sw-inspector/navigated', session }))
      .catch(() => { /* No receiver is expected after the panel closes. */ });
  };
  runtime.onMessage.addListener(onMessage);
  devtools.network.onNavigated.addListener(onNavigated);
  return () => {
    runtime.onMessage.removeListener(onMessage);
    devtools.network.onNavigated.removeListener(onNavigated);
  };
}

type PanelEvent = {
  addListener(listener: () => void): void;
  removeListener(listener: () => void): void;
};

export function installPanelVisibilityRelay(runtime: RelayRuntime, panel: { onShown: PanelEvent; onHidden: PanelEvent }, session: string): () => void {
  let visible = false;
  let opened = false;
  let disposed = false;
  const onShown = () => {
    if (disposed || visible) return;
    visible = true;
    if (!opened) { opened = true; return; } // Mount owns the initial snapshot.
    void Promise.resolve().then(() => {
      if (!disposed) return runtime.sendMessage({ kind: 'sw-inspector/panel-returned', session });
    }).catch(() => { /* The panel may have closed. */ });
  };
  const onHidden = () => { visible = false; };
  panel.onShown.addListener(onShown);
  panel.onHidden.addListener(onHidden);
  return () => {
    disposed = true;
    panel.onShown.removeListener(onShown);
    panel.onHidden.removeListener(onHidden);
  };
}

export function createPanelRelay(runtime: RelayRuntime, panelUrl: string, timeoutMs = 15_000) {
  const session = new URL(panelUrl).searchParams.get('session');

  const evaluate: EvalFn = async (source) => {
    try {
      if (!session) throw new Error('The Web Inspector session is missing; close and reopen Web Inspector');
      const response = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The devtools evaluation relay timed out')), timeoutMs);
        Promise.resolve().then(() => runtime.sendMessage({ kind: 'sw-inspector/evaluate', session, source })).then(
          (value) => { clearTimeout(timer); resolve(value); },
          (error) => { clearTimeout(timer); reject(error); },
        );
      });
      if (!isRecord(response) || response.kind !== 'sw-inspector/evaluated' || response.session !== session
        || !('result' in response) || (response.exception !== null && !isException(response.exception))) {
        throw new Error('The devtools page returned an invalid evaluation response');
      }
      return [response.result, response.exception ?? undefined];
    } catch (error) {
      return [undefined, exception(error)];
    }
  };

  function subscribe(kind: string, listener: () => void): () => void {
    if (!session) return () => {};
    const onMessage: RelayMessageListener = (message, sender) => {
      if (isRecord(message) && message.kind === kind && message.session === session
        && matchesSender(runtime, sender, 'devtools.html')) listener();
      return undefined;
    };
    runtime.onMessage.addListener(onMessage);
    return () => runtime.onMessage.removeListener(onMessage);
  }

  return {
    evaluate,
    subscribeNavigation: (listener: () => void) => subscribe('sw-inspector/navigated', listener),
    subscribePanelReturn: (listener: () => void) => subscribe('sw-inspector/panel-returned', listener),
  };
}
