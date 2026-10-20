import type { PageContext } from '../bridge/page-context';
import type { ActionHandlers, ActionIntent, ActionRejection } from '../domain/actions';
import type { PageIdentity } from '../domain/types';

// Serialized into the inspected document; keep runtime dependencies inside this factory.
export function createWorkerActions(context: PageContext): ActionHandlers {
  type Retained = {
    kind: 'update-worker' | 'unregister-worker';
    page: PageIdentity;
    registrationId: string;
    registration: ServiceWorkerRegistration;
    expiresAt: number;
    installing: ServiceWorker | null;
    waiting: ServiceWorker | null;
    active: ServiceWorker | null;
  };
  function reject(code: ActionRejection['code'], message: string): never {
    throw { kind: 'action-rejected', code, message } satisfies ActionRejection;
  }
  async function prepare(intent: ActionIntent) {
    if (intent.kind !== 'update-worker' && intent.kind !== 'unregister-worker') {
      return reject('invalid-command', 'Unsupported worker action.');
    }
    const record = context.registrations.get(intent.registrationId);
    if (!record || record.expiresAt <= Date.now() || !context.isCurrent(record.page)) {
      return reject('stale-target', 'Refresh before managing this registration.');
    }
    const page = { ...record.page };
    if (!('serviceWorker' in navigator)) return reject('unsupported', 'Service Worker API is unavailable.');
    const registrations = await navigator.serviceWorker.getRegistrations();
    const registration = record.registration;
    if (!context.isCurrent(page) || record.expiresAt <= Date.now()
      || context.registrations.get(intent.registrationId) !== record
      || !registrations.includes(registration)
      || (registration.active ?? null) !== (record.workers.active?.worker ?? null)
      || (registration.waiting ?? null) !== (record.workers.waiting?.worker ?? null)) {
      return reject('stale-target', 'Refresh before managing this registration.');
    }
    const retained: Retained = {
      kind: intent.kind, page, registrationId: intent.registrationId,
      registration, expiresAt: record.expiresAt,
      installing: registration.installing ?? null,
      waiting: registration.waiting ?? null,
      active: registration.active ?? null,
    };
    return { retained, summary: [
      intent.kind === 'update-worker' ? 'Check for update' : 'Unregister',
      page.origin, page.url, registration.scope,
      intent.kind === 'update-worker'
        ? 'This may download and install a new worker. Activation is not guaranteed.'
        : 'Existing pages may remain controlled. Cache Storage is unchanged.',
    ] };
  }
  async function execute(): Promise<never> {
    return reject('unsupported', 'Worker actions are not enabled.');
  }
  return { 'update-worker': { prepare, execute }, 'unregister-worker': { prepare, execute } };
}
