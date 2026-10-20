import { afterEach, expect, it, vi } from 'vitest';
import { createCacheActions } from '../../src/cache/page-actions';
import { createControlRunner } from '../../src/actions/page-runner';
import type { PageContext } from '../../src/bridge/page-context';
import type { ActionTicket } from '../../src/domain/actions';
function fixture(names = ['a', 'b', 'c']) {
  const page = { documentId: 'doc', origin: 'https://a.test', url: 'https://a.test/' };
  let current = true;
  const context: PageContext = { identity: () => page, isCurrent: () => current, replaceRegistrationCleanup: () => {}, onDispose: () => {}, actions: new Map(), registrations: new Map(), manifests: new Map(), messages: new Map() };
  const effects = { open: vi.fn(), fetch: vi.fn(), update: vi.fn(), unregister: vi.fn() };
  const storage = { keys: vi.fn(async () => names), delete: vi.fn(async (_name: string) => true), open: effects.open };
  vi.stubGlobal('caches', storage); vi.stubGlobal('fetch', effects.fetch);
  vi.stubGlobal('navigator', { serviceWorker: effects });
  const snapshots = new Map(names.map(cacheName => [cacheName, { cacheName }]));
  vi.stubGlobal('__batchSnapshots', snapshots);
  const handlers = createCacheActions(context, '__batchSnapshots');
  const run = createControlRunner(context, handlers);
  const prepare = () => run({ type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-all-caches' } });
  const ticket = async () => { const result = await prepare(); if (!result.ok || !('ticketId' in result.value)) throw Error('no ticket'); return result.value; };
  const commit = (value: ActionTicket) => run({ type: 'commit-action', expectedPage: page, ticketId: value.ticketId });
  return { storage, effects, snapshots, prepare, ticket, commit, handlers, isCurrent: () => current, stale: () => { current = false; } };
}
afterEach(() => vi.unstubAllGlobals());
it('new_cache_after_prepare_is_not_deleted', async () => {
  const f = fixture(['a', 'b']); const ticket = await f.ticket();
  expect(ticket.summary).toEqual(['Origin: https://a.test', 'Caches: 2', 'a', 'b', 'Cached responses in these listed caches will be removed. The site may recreate caches.']);
  f.storage.keys.mockResolvedValue(['a', 'b', 'c']);
  const result = await f.commit(ticket);
  expect(result).toMatchObject({ ok: true, value: { status: 'completed', items: [{ target: 'a', outcome: 'applied' }, { target: 'b', outcome: 'applied' }] } });
  expect(await f.commit(ticket)).toEqual(result);
  expect(f.storage.delete.mock.calls).toEqual([['a'], ['b']]);
  for (const effect of Object.values(f.effects)) expect(effect).not.toHaveBeenCalled();
});
it('one_failure_keeps_other_receipts', async () => {
  const f = fixture(); const ticket = await f.ticket();
  f.storage.delete.mockResolvedValueOnce(true).mockRejectedValueOnce(Error('denied')).mockResolvedValueOnce(true);
  expect(await f.commit(ticket)).toMatchObject({ ok: true, value: { status: 'partial', items: [{ target: 'a', outcome: 'applied' }, { target: 'b', outcome: 'failed', message: 'denied' }, { target: 'c', outcome: 'applied' }] } });
  expect([...f.snapshots.keys()]).toEqual(['b']);
});
it('navigation_between_items_stops_remaining', async () => {
  const f = fixture();
  const handler = f.handlers['delete-all-caches']!;
  const prepared = await handler.prepare({ kind: 'delete-all-caches' });
  f.storage.delete.mockImplementationOnce(async () => { f.stale(); return true; });
  expect(await handler.execute(prepared.retained, f.isCurrent)).toMatchObject( [{ target: 'a', outcome: 'applied' }, { target: 'b', outcome: 'skipped' }, { target: 'c', outcome: 'skipped' }]);
  expect(f.storage.delete.mock.calls).toEqual([['a']]);
});
it('over_100_names_is_rejected_without_truncation', async () => {
  const f = fixture(Array.from({ length: 101 }, (_, i) => String(i)));
  expect(await f.prepare()).toMatchObject({ ok: false, error: { code: 'unsupported', message: expect.stringContaining('individually') } });
  expect(f.storage.delete).not.toHaveBeenCalled();
});
it('empty_batch_has_no_effect', async () => {
  const f = fixture([]);
  expect(await f.prepare()).toMatchObject({ ok: false, error: { code: 'cache-not-found' } });
  expect(f.storage.delete).not.toHaveBeenCalled();
});
it('all_100_names_are_retained_and_execution_is_sequential', async () => {
  const names = Array.from({ length: 100 }, (_, i) => `cache-${i}`);
  const f = fixture(names); const ticket = await f.ticket();
  let pending = false;
  f.storage.delete.mockImplementation(async () => { expect(pending).toBe(false); pending = true; await Promise.resolve(); pending = false; return true; });
  expect(ticket.summary.slice(2, 102)).toEqual(names);
  await f.commit(ticket); expect(f.storage.delete.mock.calls.map(([name]) => name)).toEqual(names);
});

it('runner_does_not_publish_receipt_into_a_changed_document', async () => {
  const f = fixture(); const ticket = await f.ticket();
  f.storage.delete.mockImplementationOnce(async () => { f.stale(); return true; });
  expect(await f.commit(ticket)).toMatchObject({ ok: false, error: { code: 'outcome-unknown' } });
  expect(f.storage.delete.mock.calls).toEqual([['a']]);
});

it('an_absent_name_is_not_reported_as_applied', async () => {
  const f = fixture(['a']); const ticket = await f.ticket(); f.storage.delete.mockResolvedValueOnce(false);
  expect(await f.commit(ticket)).toMatchObject({ ok: true, value: { status: 'completed', items: [{ target: 'a', outcome: 'absent' }] } });
  expect(f.snapshots.size).toBe(0);
});
