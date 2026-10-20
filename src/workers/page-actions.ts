import type { PageContext } from '../bridge/page-context';
import type { ActionHandlers, ActionIntent, ActionItem, ActionRejection } from '../domain/actions';
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
  function validate(retained: Retained, isCurrent: () => boolean) {
    const record = context.registrations.get(retained.registrationId);
    const registration = retained.registration;
    if (!isCurrent() || !context.isCurrent(retained.page) || retained.expiresAt <= Date.now()
      || !record || record.registration !== registration || record.expiresAt !== retained.expiresAt
      || !context.isCurrent(record.page)
      || (registration.installing ?? null) !== retained.installing
      || (registration.waiting ?? null) !== retained.waiting
      || (registration.active ?? null) !== retained.active) {
      return reject('stale-target', 'Refresh before managing this registration.');
    }
  }
  async function execute(kind: Retained['kind'], value: unknown, isCurrent: () => boolean): Promise<ActionItem[]> {
    const retained = value as Retained;
    if (retained.kind !== kind) return reject('invalid-command', 'Unsupported worker action.');
    validate(retained, isCurrent);
    if (!('serviceWorker' in navigator)) return reject('unsupported', 'Service Worker API is unavailable.');
    const registrations = await navigator.serviceWorker.getRegistrations();
    validate(retained, isCurrent);
    if (!registrations.includes(retained.registration)) {
      return reject('stale-target', 'Refresh before managing this registration.');
    }
    const target = retained.registration.scope;
    try {
      if (kind === 'update-worker') {
        await retained.registration.update();
        return [{ target, outcome: 'applied', message: 'Update check completed. Activation is not guaranteed.' }];
      }
      const removed = await retained.registration.unregister();
      return [{ target, outcome: removed ? 'applied' : 'absent', message: removed
        ? 'Unregister request completed. Existing pages may remain controlled.' : 'Registration was not found.' }];
    } catch (error) {
      return [{ target, outcome: 'failed', message: error instanceof Error ? error.message : String(error) }];
    }
  }
  return {
    'update-worker': { prepare, execute: (value, isCurrent) => execute('update-worker', value, isCurrent) },
    'unregister-worker': { prepare, execute: (value, isCurrent) => execute('unregister-worker', value, isCurrent) },
  };
}
