import type { PageIdentity } from '../domain/types';

export type WorkerSlot = 'active' | 'waiting';
export type RetainedRegistration = {
  registration: ServiceWorkerRegistration;
  expiresAt: number;
  workers: Partial<Record<WorkerSlot, { workerId: string; worker: ServiceWorker }>>;
};
export interface PageContext {
  identity(): PageIdentity;
  isCurrent(expected: PageIdentity): boolean;
  onDispose(cleanup: () => void): void;
  registrations: Map<string, RetainedRegistration>;
  actions: Map<string, unknown>;
  manifests: Map<string, unknown>;
  messages: Map<string, unknown>;
}

// Serialized into the inspected document; keep all runtime dependencies inside this factory.
export function createPageContext(registryKey: string): PageContext {
  type StoredContext = { context: PageContext; closed: boolean };
  const root = globalThis as Record<string, unknown>;
  const previous = root[registryKey] as StoredContext | undefined;
  if (previous && !previous.closed) return previous.context;

  const documentId = crypto.randomUUID();
  const cleanups = new Set<() => void>();
  const stored: StoredContext = { context: undefined!, closed: false };
  const context: PageContext = {
    identity: () => ({ documentId, origin: location.origin, url: location.href }),
    isCurrent(expected) {
      const current = context.identity();
      return !stored.closed && expected.documentId === current.documentId
        && expected.origin === current.origin && expected.url === current.url;
    },
    onDispose(cleanup) {
      if (stored.closed) cleanup();
      else cleanups.add(cleanup);
    },
    registrations: new Map(), actions: new Map(), manifests: new Map(), messages: new Map(),
  };
  function dispose() {
    if (stored.closed) return;
    stored.closed = true;
    globalThis.removeEventListener('pagehide', dispose);
    context.registrations.clear();
    context.actions.clear();
    context.manifests.clear();
    context.messages.clear();
    for (const cleanup of cleanups) {
      try { cleanup(); } catch { /* One owner must not prevent other resources from closing. */ }
    }
    cleanups.clear();
  }
  stored.context = context;
  root[registryKey] = stored;
  globalThis.addEventListener('pagehide', dispose);
  return context;
}
