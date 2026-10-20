import { afterEach, expect, it, vi } from 'vitest';
import { createCacheActions } from '../../src/cache/page-actions';
import type { PageContext } from '../../src/bridge/page-context';

function fixture() {
  const page = { documentId: 'doc', origin: 'https://a.test', url: 'https://a.test/' };
  const context: PageContext = { identity: () => page, isCurrent: () => true, replaceRegistrationCleanup: () => {}, onDispose: () => {}, actions: new Map(), registrations: new Map(), manifests: new Map(), messages: new Map() };
  const request = new Request('https://a.test/a?v=1', { headers: { 'Accept-Language': 'en' } });
  const cache = { delete: vi.fn(async () => true) };
  const snapshot = { cacheName: 'a', cache, requests: [request], expiresAt: Date.now() + 60_000 };
  const snapshots = new Map([['id', snapshot], ['other-a', { ...snapshot }], ['other-b', { ...snapshot, cacheName: 'b' }]]);
  vi.stubGlobal('__entrySnapshots', snapshots);
  const storage = { open: vi.fn(), delete: vi.fn(), keys: vi.fn() };
  vi.stubGlobal('caches', storage);
  const handler = createCacheActions(context, '__entrySnapshots')['delete-cache-entry']!;
  const prepare = (requestKey = 'id:0', cacheName = 'a') => handler.prepare({ kind: 'delete-cache-entry', cacheName, requestKey });
  return { handler, prepare, snapshot, snapshots, cache, storage, request };
}
afterEach(() => vi.unstubAllGlobals());
it.each(['id:', 'id:-1', 'id:0:1', 'id:0.5', 'id:1', 'id:00', 'id: 0', 'id:1e0'])('request_key_requires_canonical_integer_index %s', async key => {
  const f = fixture();
  await expect(f.prepare(key)).rejects.toMatchObject({ message: 'Refresh this cache before deleting an entry.' });
  expect(f.cache.delete).not.toHaveBeenCalled();
});
it('wrong_cache_or_expired_snapshot_never_deletes', async () => {
  const f = fixture();
  await expect(f.prepare('id:0', 'b')).rejects.toMatchObject({ code: 'stale-target' });
  f.snapshot.expiresAt = Date.now();
  await expect(f.prepare()).rejects.toMatchObject({ code: 'stale-target' });
  expect(f.cache.delete).not.toHaveBeenCalled();
});
it('selected_request_and_retained_cache_are_used and delete_invalidates_whole_inventory_for_that_cache', async () => {
  const f = fixture(); const target = await f.prepare();
  expect(target.summary).toContain('Request: GET https://a.test/a?v=1');
  expect(await f.handler.execute(target.retained, () => true)).toMatchObject([{ outcome: 'applied' }]);
  expect(f.cache.delete).toHaveBeenCalledExactlyOnceWith(f.request);
  expect([...f.snapshots.keys()]).toEqual(['other-b']);
  for (const effect of Object.values(f.storage)) expect(effect).not.toHaveBeenCalled();
});
it.each(['expired', 'evicted', 'navigation'])('prepared target %s makes zero calls', async reason => {
  const f = fixture(); const target = await f.prepare();
  if (reason === 'expired') f.snapshot.expiresAt = Date.now();
  if (reason === 'evicted') f.snapshots.delete('id');
  await expect(f.handler.execute(target.retained, () => reason !== 'navigation')).rejects.toMatchObject({ code: 'stale-target' });
  expect(f.cache.delete).not.toHaveBeenCalled();
});
it('entry_false_means_not_present and rejection means failed', async () => {
  const f = fixture(); const target = await f.prepare(); f.cache.delete.mockResolvedValueOnce(false);
  expect(await f.handler.execute(target.retained, () => true)).toMatchObject([{ outcome: 'absent' }]);
  const g = fixture(); const next = await g.prepare(); g.cache.delete.mockRejectedValueOnce(Error('denied'));
  expect(await g.handler.execute(next.retained, () => true)).toMatchObject([{ outcome: 'failed', message: 'denied' }]);
});
