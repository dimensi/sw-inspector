import { createPageContext } from '../../src/bridge/page-context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageRunner, executeDiagnostic } from '../../src/diagnostics/page-runner';
import { createCacheActions } from '../../src/cache/page-actions';
import type { DiagnosticCommand, CacheDetails, CacheInventory, OfflineCheck, Overview, Result } from '../../src/domain/types';

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
          if (typeof input === 'string') return records.find((record) => record.request.url === input)?.response.clone();
          return records.find((record) => record.request === input)?.response.clone();
        },
      };
    }),
    match: vi.fn(async (input: Request | string) => {
      const url = typeof input === 'string' ? new URL(input, origin).href : input.url;
      return [...caches.values()].flat().find((record) => record.request.url === url)?.response;
    }),
  };
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('location', { origin, href: `${origin}/` });
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
  it('expired_preview_snapshot_requires_refresh without prolonging TTL', async () => {
    vi.useFakeTimers();
    try {
      installOrigin({ runtime: [{ request: new Request('https://app.test/a'), response: new Response('a', { headers: { 'content-type': 'text/plain' } }) }] });
      const key = `snapshots-${crypto.randomUUID()}`;
      const context = createPageContext(`context-${crypto.randomUUID()}`);
      const run = createPageRunner(key, context);
      const inventory = value(await run({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
      const requestKey = inventory.entries[0].requestKey;
      vi.setSystemTime(Date.now() + 299_999);
      expect(await run({ type: 'get-response-details', cacheName: 'runtime', requestKey, preview: true })).toMatchObject({ ok: true });
      vi.setSystemTime(Date.now() + 1);
      await expect(createCacheActions(context, key)['delete-cache-entry']!.prepare({ kind: 'delete-cache-entry', cacheName: 'runtime', requestKey })).rejects.toMatchObject({ message: 'Refresh this cache before deleting an entry.' });
      delete (globalThis as Record<string, unknown>)[key];
    } finally { vi.useRealTimers(); }
  });

  it('rejects malformed details keys without poisoning a valid snapshot', async () => {
    installOrigin({ runtime: [{ request: new Request('https://app.test/a'), response: new Response('a') }] });
    const run = createPageRunner(`snapshots-${crypto.randomUUID()}`);
    const inventory = value(await run({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
    for (const index of ['', '-1', '00', '0:1', '0.5', ' 0']) expect(await run({ type: 'get-response-details', cacheName: 'runtime', requestKey: `${inventory.snapshotId}:${index}` })).toMatchObject({ ok: false, error: { code: 'stale-snapshot' } });
    expect(await run({ type: 'get-response-details', cacheName: 'runtime', requestKey: inventory.entries[0].requestKey })).toMatchObject({ ok: true });
  });
  it('does not retain a late inventory after pagehide', async () => {
    const { storage } = installOrigin({ runtime: [] });
    const events = new EventTarget();
    vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
    vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
    let resolveKeys!: (requests: Request[]) => void;
    const keys = vi.fn(() => new Promise<Request[]>((resolve) => { resolveKeys = resolve; }));
    storage.open.mockResolvedValue({ keys, match: async () => undefined });
    const contextKey = `context-${crypto.randomUUID()}`;
    const snapshotsKey = `snapshots-${crypto.randomUUID()}`;
    const pending = createPageRunner(snapshotsKey, createPageContext(contextKey))({ type: 'list-cache-keys', cacheName: 'runtime' });
    while (!keys.mock.calls.length) await Promise.resolve();
    events.dispatchEvent(new Event('pagehide'));
    resolveKeys([new Request('https://app.test/a')]);
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'stale-result' } });
    expect((globalThis as Record<string, unknown>)[snapshotsKey]).toBeUndefined();
    delete (globalThis as Record<string, unknown>)[contextKey];
  });

  it('clears snapshots through repeated BFCache restores and pagehide', async () => {
    installOrigin({ runtime: [{ request: new Request('https://app.test/a'), response: new Response('a') }] });
    const events = new EventTarget();
    vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
    vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
    const contextKey = `context-${crypto.randomUUID()}`;
    const snapshotsKey = `snapshots-${crypto.randomUUID()}`;
    for (let round = 0; round < 2; round += 1) {
      const runner = createPageRunner(snapshotsKey, createPageContext(contextKey));
      const inventory = value(await runner({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
      const snapshots = (globalThis as Record<string, unknown>)[snapshotsKey] as Map<string, unknown>;
      expect(snapshots.size).toBe(1);
      events.dispatchEvent(new Event('pagehide'));
      expect(snapshots.size).toBe(0);
      events.dispatchEvent(new Event('pageshow'));
      const restoredRunner = createPageRunner(snapshotsKey, createPageContext(contextKey));
      await expect(restoredRunner({ type: 'get-response-details', cacheName: 'runtime', requestKey: inventory.entries[0].requestKey })).resolves.toMatchObject({ ok: false, error: { code: 'stale-snapshot' } });
    }
    delete (globalThis as Record<string, unknown>)[contextKey];
    delete (globalThis as Record<string, unknown>)[snapshotsKey];
  });

  it.each(['overview', 'page-context'] as const)('rejects %s without an injected context', async (type) => {
    await expect(createPageRunner()({ type })).resolves.toMatchObject({
      ok: false, error: { code: 'invalid-command', message: `Page context is required for ${type}` },
    });
  });

  it('unknown_command_does_not_run_check_urls', async () => {
    const { storage } = installOrigin({});
    await expect(executeDiagnostic({ type: 'unknown', paths: ['/'] } as unknown as DiagnosticCommand)).resolves.toMatchObject({ ok: false, error: { code: 'invalid-command' } });
    expect(storage.match).not.toHaveBeenCalled();
    expect(storage.keys).not.toHaveBeenCalled();
  });

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

  it('finishes oversized previews without waiting for stream cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(48 * 1024 + 1)); },
      cancel,
    }), { headers: { 'content-type': 'application/javascript' } });
    const { storage } = installOrigin({ runtime: [] });
    const request = new Request('https://app.test/large.js');
    storage.open.mockResolvedValue({ keys: async () => [request], match: async () => response });
    const inventory = value(await executeDiagnostic({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
    const result = value(await executeDiagnostic({ type: 'get-response-details', cacheName: 'runtime', requestKey: inventory.entries[0].requestKey, preview: true }) as Result<CacheDetails>);
    expect(result.preview).toEqual({ kind: 'text', text: '\u0000'.repeat(48 * 1024), truncated: true });
    expect(cancel).toHaveBeenCalledOnce();
  }, 500);

  it('loads the full response only on explicit request and preserves UTF-8 boundaries', async () => {
    const body = 'a'.repeat(48 * 1024 - 1) + '€tail';
    installOrigin({ runtime: [{ request: new Request('https://app.test/large'), response: new Response(body, { headers: { 'content-type': 'text/plain' } }) }] });
    const inventory = value(await executeDiagnostic({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
    const command = { type: 'get-response-details' as const, cacheName: 'runtime', requestKey: inventory.entries[0].requestKey, preview: true };
    const partial = value(await executeDiagnostic(command) as Result<CacheDetails>);
    expect(partial.preview).toEqual({ kind: 'text', text: 'a'.repeat(48 * 1024 - 1), truncated: true });
    const full = value(await executeDiagnostic({ ...command, fullPreview: true }) as Result<CacheDetails>);
    expect(full.preview).toEqual({ kind: 'text', text: body });
  });

  it('keeps the inventory usable after previewing a response', async () => {
    installOrigin({ runtime: ['first', 'second'].map((body) => ({
      request: new Request(`https://app.test/${body}`),
      response: new Response(body, { headers: { 'content-type': 'text/plain' } }),
    })) });
    const inventory = value(await executeDiagnostic({ type: 'list-cache-keys', cacheName: 'runtime' }) as Result<CacheInventory>);
    for (const index of [0, 1, 0]) {
      const command = { type: 'get-response-details' as const, cacheName: 'runtime', requestKey: inventory.entries[index].requestKey };
      const metadata = value(await executeDiagnostic(command) as Result<CacheDetails>);
      expect(metadata.preview).toEqual({ kind: 'not-requested' });
      const preview = value(await executeDiagnostic({ ...command, preview: true }) as Result<CacheDetails>);
      expect(preview.preview).toEqual({ kind: 'text', text: index === 0 ? 'first' : 'second' });
    }
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
