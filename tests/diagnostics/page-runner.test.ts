import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDiagnostic } from '../../src/diagnostics/page-runner';
import type { CacheDetails, CacheInventory, OfflineCheck, Overview, Result } from '../../src/domain/types';

type Stored = { request: Request; response: Response };

function installOrigin(entries: Record<string, Stored[]>, options: { registrations?: unknown[]; controller?: unknown; estimate?: { usage?: number; quota?: number } } = {}) {
  const origin = 'https://app.test';
  const caches = new Map(Object.entries(entries));
  const storage = {
    keys: vi.fn(async () => [...caches.keys()]),
    open: vi.fn(async (name: string) => {
      const records = caches.get(name);
      if (!records) throw new Error('cache missing');
      return {
        keys: async () => records.map((record) => record.request),
        match: async (input: Request | string) => {
          if (typeof input === 'string') return records.find((record) => record.request.url === input)?.response;
          return records.find((record) => record.request === input)?.response;
        },
      };
    }),
    match: vi.fn(async (input: Request | string) => {
      const url = typeof input === 'string' ? new URL(input, origin).href : input.url;
      return [...caches.values()].flat().find((record) => record.request.url === url)?.response;
    }),
  };
  vi.stubGlobal('location', { origin });
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('navigator', {
    serviceWorker: {
      controller: options.controller ?? null,
      getRegistrations: async () => options.registrations ?? [],
    },
    storage: { estimate: async () => options.estimate ?? {} },
  });
  return { origin, storage };
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

afterEach(() => vi.unstubAllGlobals());

describe('page diagnostic runner', () => {
  it('keeps an empty no-Service-Worker origin observable', async () => {
    installOrigin({});
    const overview = value<Overview>(await executeDiagnostic({ type: 'overview' }) as Result<Overview>);
    expect(overview.registrations).toEqual([]);
    expect(overview.controller).toBeNull();
    expect(overview.caches).toEqual([]);
    expect(overview.storage).toEqual({ usageBytes: null, quotaBytes: null });
  });

  it('reports registration states and whole-origin storage without waiting for ready', async () => {
    const origin = 'https://app.test';
    installOrigin({}, {
      controller: { scriptURL: `${origin}/sw.js`, state: 'activated' },
      registrations: [{
        scope: `${origin}/scope/`,
        installing: { scriptURL: `${origin}/next.js`, state: 'installing' },
        waiting: { scriptURL: `${origin}/waiting.js`, state: 'installed' },
        active: { scriptURL: `${origin}/sw.js`, state: 'activated' },
      }],
      estimate: { usage: 12, quota: 100 },
    });
    const overview = value<Overview>(await executeDiagnostic({ type: 'overview' }) as Result<Overview>);
    expect(overview.controller?.scriptURL).toBe(`${origin}/sw.js`);
    expect(overview.registrations[0]).toMatchObject({ scope: `${origin}/scope/`, active: { state: 'activated' } });
    expect(overview.storage).toEqual({ usageBytes: 12, quotaBytes: 100 });
  });

  it('uses snapshot identity rather than URL when duplicate requests have different responses', async () => {
    const url = 'https://app.test/data';
    const first = new Request(url, { headers: { accept: 'text/plain' } });
    const second = new Request(url, { headers: { accept: 'application/json' } });
    installOrigin({ runtime: [
      { request: first, response: new Response('first', { status: 200, headers: { 'content-type': 'text/plain' } }) },
      { request: second, response: new Response('{"second":true}', { status: 201, headers: { 'content-type': 'application/json' } }) },
    ] });
    const inventory = value<CacheInventory>(await executeDiagnostic({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
    expect(inventory.entries.map((entry) => entry.url)).toEqual([url, url]);
    expect(inventory.entries[0].requestKey).not.toBe(inventory.entries[1].requestKey);
    const details = value<CacheDetails>(await executeDiagnostic({ type: 'get-response-details', cacheName: 'runtime', requestKey: inventory.entries[1].requestKey, preview: true }) as Result<CacheDetails>);
    expect(details.status).toBe(201);
    expect(details.preview).toEqual({ kind: 'text', text: '{"second":true}' });
  });

  it('does not create a missing cache while rejecting a stale name', async () => {
    const { storage } = installOrigin({ runtime: [] });
    const result = await executeDiagnostic({ type: 'list-cache-keys', cacheName: 'missing' });
    expect(result).toMatchObject({ ok: false, error: { code: 'cache-not-found' } });
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('expires snapshots instead of resolving stale entry keys', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    installOrigin({ runtime: [{ request: new Request('https://app.test/a'), response: new Response('a') }] });
    const inventory = value<CacheInventory>(await executeDiagnostic({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
    vi.setSystemTime(new Date('2026-10-19T12:06:00Z'));
    await expect(executeDiagnostic({ type: 'get-response-details', cacheName: 'runtime', requestKey: inventory.entries[0].requestKey })).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale-snapshot' },
    });
    vi.useRealTimers();
  });

  it('rejects an out-of-range snapshot key without reading Cache Storage', async () => {
    const { storage } = installOrigin({ runtime: [{ request: new Request('https://app.test/a'), response: new Response('a') }] });
    const inventory = value<CacheInventory>(await executeDiagnostic({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
    const before = storage.open.mock.calls.length;
    await expect(executeDiagnostic({ type: 'get-response-details', cacheName: 'runtime', requestKey: `${inventory.snapshotId}:1` })).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale-snapshot' },
    });
    expect(storage.open).toHaveBeenCalledTimes(before);
  });

  it('checks same-origin cache keys without fetching the network', async () => {
    const { storage } = installOrigin({ shell: [{ request: new Request('https://app.test/calls'), response: new Response('ok', { status: 200 }) }] });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const checks = value<OfflineCheck[]>(await executeDiagnostic({ type: 'check-urls', paths: ['/calls', '/missing', 'https://other.test/x', 'javascript:alert(1)'] }) as Result<OfflineCheck[]>);
    expect(checks.map((check) => check.found)).toEqual([true, false, false, false]);
    expect(checks[2].error?.code).toBe('invalid-url');
    expect(checks[3].error?.code).toBe('invalid-url');
    expect(storage.match).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
