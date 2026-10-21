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

export type PanelLifecycleState = { hiddenEpoch: number };

export function installDevtoolsRelay(runtime: RelayRuntime, devtools: Devtools, session: string, lifecycle: PanelLifecycleState = { hiddenEpoch: 0 }): () => void {
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
    if (!isRecord(message) || message.session !== session || !matchesSender(runtime, sender, 'panel.html', session)) return;
    if (message.kind === 'sw-inspector/panel-activation') {
      respond({ kind: 'sw-inspector/panel-activation', session, epoch: lifecycle.hiddenEpoch });
      return true;
    }
    if (message.kind !== 'sw-inspector/evaluate') return;
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

export function installPanelVisibilityRelay(runtime: RelayRuntime, panel: { onShown: PanelEvent; onHidden: PanelEvent }, session: string, lifecycle: PanelLifecycleState = { hiddenEpoch: 0 }): () => void {
  let visible = false;
  let disposed = false;
  const onShown = () => {
    if (disposed || visible) return;
    visible = true;
    if (lifecycle.hiddenEpoch === 0) return; // Mount owns the initial snapshot.
    void Promise.resolve().then(() => {
      if (disposed) return;
      return runtime.sendMessage({ kind: 'sw-inspector/panel-returned', session, epoch: lifecycle.hiddenEpoch });
    }).catch(() => { /* The panel may have closed. */ });
  };
  const onHidden = () => {
    if (disposed) return;
    lifecycle.hiddenEpoch += 1;
    visible = false;
    const epoch = lifecycle.hiddenEpoch;
    void Promise.resolve().then(() => {
      if (!disposed) return runtime.sendMessage({ kind: 'sw-inspector/panel-hidden', session, epoch });
    }).catch(() => { /* The panel may already be closed. */ });
  };
  try {
    panel.onShown.addListener(onShown);
    panel.onHidden.addListener(onHidden);
  } catch {
    panel.onShown?.removeListener(onShown);
    panel.onHidden?.removeListener(onHidden);
    return () => {};
  }
  return () => {
    disposed = true;
    panel.onShown.removeListener(onShown);
    panel.onHidden.removeListener(onHidden);
  };
}

export function createPanelRelay(runtime: RelayRuntime, panelUrl: string, timeoutMs = 15_000) {
  const session = new URL(panelUrl).searchParams.get('session');
  let appliedEpoch = 0;
  let hiddenEpoch = 0;
  let activationGeneration = 0;
  let initializing = false;
  let initialized = true;
  let initialization: Promise<void> = Promise.resolve();

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
      if (!isRecord(message) || message.kind !== kind) return;
      if (message.session !== session || !matchesSender(runtime, sender, 'devtools.html')) return;
      if (kind === 'sw-inspector/panel-returned') {
        if (!initializing && initialized) applyPanelEpoch(message.epoch, listener);
      } else if (kind === 'sw-inspector/panel-hidden') {
        const epoch = message.epoch;
        if (typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch > hiddenEpoch && epoch > appliedEpoch) { hiddenEpoch = epoch; listener(); }
      } else listener();
      return undefined;
    };
    runtime.onMessage.addListener(onMessage);
    return () => runtime.onMessage.removeListener(onMessage);
  }

  function applyPanelEpoch(epoch: unknown, listener: () => void) {
    if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0 || epoch <= appliedEpoch) return;
    appliedEpoch = epoch;
    listener();
  }

  async function queryPanelEpoch(): Promise<number> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => runtime.sendMessage({ kind: 'sw-inspector/panel-activation', session })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Panel activation timed out')), timeoutMs); }),
      ]);
      if (!session || !isRecord(response) || response.kind !== 'sw-inspector/panel-activation' || response.session !== session
        || typeof response.epoch !== 'number' || !Number.isSafeInteger(response.epoch) || response.epoch < 0) throw new Error('Invalid panel activation response');
      return response.epoch;
    } finally {
      clearTimeout(timer);
    }
  }

  function initializePanelActivation() {
    if (initializing) return initialization;
    initializing = true;
    initialized = false;
    initialization = queryPanelEpoch().then((epoch) => {
      appliedEpoch = epoch;
      initialized = true;
    }).catch(() => { /* A later active event may re-establish the baseline. */ }).finally(() => { initializing = false; });
    return initialization;
  }

  async function requestPanelActivation(listener: () => void, isActive: () => boolean) {
    const generation = ++activationGeneration;
    if (!isActive()) return;
    if (!initialized && !initializing) void initializePanelActivation();
    await initialization;
    if (!initialized || generation !== activationGeneration || !isActive()) return;
    try {
      const epoch = await queryPanelEpoch();
      if (generation === activationGeneration && isActive()) applyPanelEpoch(epoch, listener);
    } catch {
      // Manual Refresh remains available; a later activation can query again.
    }
  }

  return {
    evaluate,
    initializePanelActivation,
    requestPanelActivation,
    cancelPanelActivation: () => { activationGeneration += 1; },
    subscribeNavigation: (listener: () => void) => subscribe('sw-inspector/navigated', listener),
    subscribePanelReturn: (listener: () => void) => subscribe('sw-inspector/panel-returned', listener),
    subscribePanelHidden: (listener: () => void) => subscribe('sw-inspector/panel-hidden', listener),
  };
}
