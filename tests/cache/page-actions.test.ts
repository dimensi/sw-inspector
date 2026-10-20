import { afterEach, expect, it, vi } from 'vitest';
import { createCacheActions } from '../../src/cache/page-actions';
import { createControlRunner } from '../../src/actions/page-runner';
import type { PageContext } from '../../src/bridge/page-context';
import type { ActionTicket } from '../../src/domain/actions';
function fixture() {
  const page = { documentId: 'doc', origin: 'https://a.test', url: 'https://a.test/' };
  let current = true;
  const context: PageContext = { identity: () => page, isCurrent: () => current, onDispose: () => {}, actions: new Map(), registrations: new Map(), manifests: new Map(), messages: new Map() };
  const effects = { open: vi.fn(), fetch: vi.fn(), update: vi.fn(), unregister: vi.fn() };
  const storage = { keys: vi.fn(async () => ['a']), delete: vi.fn(async () => true), open: effects.open };
  vi.stubGlobal('caches', storage); vi.stubGlobal('fetch', effects.fetch);
  vi.stubGlobal('navigator', { serviceWorker: { update: effects.update, unregister: effects.unregister } });
  const snapshots = new Map([['a1', { cacheName: 'a' }], ['b1', { cacheName: 'b' }]]);
  vi.stubGlobal('__testSnapshots', snapshots);
  const handlers = createCacheActions(context, '__testSnapshots');
  const run = createControlRunner(context, handlers);
  const prepare = () => run({ type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-cache', cacheName: 'a' } });
  const ticket = async () => { const r = await prepare(); if (!r.ok || !('ticketId' in r.value)) throw Error('no ticket'); return r.value; };
  const commit = (t: ActionTicket) => run({ type: 'commit-action', expectedPage: page, ticketId: t.ticketId });
  return { page, storage, effects, snapshots, handlers, prepare, ticket, commit, stale: () => { current = false; } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('delete_namespace_never_opens_cache', async () => {
  const f = fixture(); const ticket = await f.ticket();
  expect(ticket.summary).toEqual(['Origin: https://a.test', 'Cache: a', 'Cached responses will be removed. The site may recreate this cache.']);
  expect(f.storage.delete).not.toHaveBeenCalled();
  const result = await f.commit(ticket);
  expect(result).toMatchObject({ ok: true, value: { items: [{ target: 'a', outcome: 'applied' }] } });
  expect(await f.commit(ticket)).toEqual(result);
  expect(f.storage.delete).toHaveBeenCalledExactlyOnceWith('a');
  for (const effect of Object.values(f.effects)) expect(effect).not.toHaveBeenCalled();
  expect([...f.snapshots.keys()]).toEqual(['b1']);
});
it('absent_namespace_has_no_success_claim', async () => {
  const f = fixture(); f.storage.keys.mockResolvedValueOnce([]);
  expect(await f.prepare()).toMatchObject({ ok: false, error: { code: 'cache-not-found' } });
  expect(f.storage.delete).not.toHaveBeenCalled();
  const ticket = await f.ticket(); f.storage.delete.mockResolvedValueOnce(false);
  expect(await f.commit(ticket)).toMatchObject({ ok: true, value: { items: [{ outcome: 'absent' }] } });
});
it('delete_rejection_preserves_inspection', async () => {
  const f = fixture(); const ticket = await f.ticket(); f.storage.delete.mockRejectedValueOnce(Error('denied'));
  expect(await f.commit(ticket)).toMatchObject({ ok: true, value: { status: 'partial', items: [{ outcome: 'failed', message: 'denied' }] } });
  expect(f.snapshots.has('a1')).toBe(true);
});
it('expired_ticket_makes_zero_delete_calls', async () => {
  vi.useFakeTimers(); const f = fixture(); const ticket = await f.ticket(); await vi.advanceTimersByTimeAsync(30_000);
  expect(await f.commit(ticket)).toMatchObject({ ok: false, error: { code: 'action-expired' } }); expect(f.storage.delete).not.toHaveBeenCalled();
});
it('current check directly guards delete and unavailable APIs reject prepare', async () => {
  const f = fixture(); const prepared = await f.handlers['delete-cache']!.prepare({ kind: 'delete-cache', cacheName: 'a' });
  await expect(f.handlers['delete-cache']!.execute(prepared.retained, () => false)).rejects.toMatchObject({ code: 'stale-target' });
  expect(f.storage.delete).not.toHaveBeenCalled();
  vi.stubGlobal('caches', undefined);
  expect(await f.prepare()).toMatchObject({ ok: false, error: { code: 'unsupported' } });
});
