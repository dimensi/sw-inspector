import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageContext } from '../../src/bridge/page-context';
import { createManifestRunner } from '../../src/manifest/page-runner';
import type { ManifestDiscovery, ManifestFetch } from '../../src/manifest/types';
import type { Result } from '../../src/domain/types';

async function setup(crossOrigin: string | null = null) {
  const events = new EventTarget();
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
  vi.stubGlobal('location', { origin: 'https://app.test', href: 'https://app.test/page' });
  const link = { raw: '/m.json', href: 'https://app.test/m.json', crossOrigin, referrerPolicy: 'no-referrer', getAttribute() { return this.raw; } };
  const links = [link];
  vi.stubGlobal('document', { querySelectorAll: () => links });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const context = createPageContext(`manifest-fetch-${crypto.randomUUID()}`);
  const run = createManifestRunner(context);
  const expectedPage = context.identity();
  const result = await run({ type: 'manifest:discover', expectedPage }) as Result<ManifestDiscovery>;
  if (!result.ok) throw new Error(result.error.message);
  const command = { type: 'manifest:fetch', expectedPage, snapshotId: result.value.snapshotId! } as const;
  return { run, command, fetch, context, link, links, events };
}
function response(chunks: Uint8Array[] = [new TextEncoder().encode('{}')], options: { url?: string; status?: number; type?: string; body?: boolean } = {}) {
  const read = vi.fn(async (): Promise<ReadableStreamReadResult<Uint8Array>> => chunks.length ? { done: false, value: chunks.shift()! } : { done: true, value: undefined });
  const cancel = vi.fn(async () => {});
  const reader = { read, cancel };
  return { reader, value: { url: options.url ?? 'https://app.test/m.json', status: options.status ?? 200,
    type: options.type ?? 'basic', redirected: !!options.url, headers: new Headers({ 'content-type': 'application/manifest+json', 'content-length': '1' }),
    body: options.body === false ? null : { getReader: () => reader },
    text: vi.fn(() => { throw new Error('unbounded text forbidden'); }),
    json: vi.fn(() => { throw new Error('unbounded json forbidden'); }),
    blob: vi.fn(() => { throw new Error('unbounded blob forbidden'); }),
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('manifest bounded fetch', () => {
  it.each([262144, 262145])('bounds body at %s actual bytes without trusting Content-Length', async length => {
    const s = await setup(); const r = response([new Uint8Array(length)]); s.fetch.mockResolvedValue(r.value);
    const result = await s.run(s.command) as Result<ManifestFetch>;
    expect(result).toMatchObject({ ok: true, value: { state: length === 262144 ? 'loaded' : 'failed', readBytes: length } });
    if (result.ok && result.value.state === 'loaded') expect(result.value.text.length).toBe(length);
    else expect(result).toMatchObject({ value: { reason: 'too-large' } });
    if (length > 262144) expect(result).not.toHaveProperty('value.text');
    expect(r.reader.cancel).toHaveBeenCalledTimes(1);
    for (const method of ['text', 'json', 'blob'] as const) expect(r.value[method]).not.toHaveBeenCalled();
  });
  it.each([null, '', 'anonymous', 'use-credentials', 'USE-CREDENTIALS'])('uses one exact cors fetch for crossorigin %s', async crossOrigin => {
    const s = await setup(crossOrigin); const r = response(); s.fetch.mockResolvedValue(r.value);
    expect(await s.run(s.command)).toMatchObject({ ok: true, value: { state: 'loaded' } });
    expect(s.fetch).toHaveBeenCalledExactlyOnceWith('https://app.test/m.json', { mode: 'cors', credentials: crossOrigin?.toLowerCase() === 'use-credentials' ? 'include' : 'same-origin', redirect: 'follow', cache: 'default', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal) });
  });
  it('records the redirect final URL and decodes bounded complete UTF-8', async () => {
    const s = await setup(); const encoded = new TextEncoder().encode('€');
    s.fetch.mockResolvedValue(response([encoded.slice(0, 1), new Uint8Array(), encoded.slice(1)], { url: 'https://cdn.test/manifests/final.json' }).value);
    expect(await s.run(s.command)).toMatchObject({ ok: true, value: { state: 'loaded', text: '€', requestedURL: 'https://app.test/m.json', finalURL: 'https://cdn.test/manifests/final.json', redirected: true, readBytes: 3 } });
  });
  it.each(['raw', 'href', 'crossOrigin', 'referrerPolicy', 'first', 'page', 'expired', 'evicted'] as const)('rejects stale %s before dispatch', async change => {
    const s = await setup();
    if (change === 'raw') s.link.raw = '/changed';
    if (change === 'href') s.link.href = 'https://app.test/changed';
    if (change === 'crossOrigin') s.link.crossOrigin = 'use-credentials';
    if (change === 'referrerPolicy') s.link.referrerPolicy = 'origin';
    if (change === 'first') s.links.unshift({ ...s.link });
    if (change === 'page') location.href += '?new';
    if (change === 'expired') vi.setSystemTime(Date.now() + 60000);
    if (change === 'evicted') for (let i = 0; i < 8; i++) await s.run({ type: 'manifest:discover', expectedPage: s.command.expectedPage });
    expect(await s.run(s.command)).toMatchObject({ ok: false, error: { code: change === 'expired' || change === 'evicted' ? 'stale-snapshot' : 'stale-result' } });
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it.each(['headers', 'read'] as const)('rejects a changed link after awaited %s without publishing source', async stage => {
    const s = await setup(); const r = response();
    if (stage === 'headers') s.fetch.mockImplementation(async () => { s.link.raw = '/new'; return r.value; });
    else { s.fetch.mockResolvedValue(r.value); r.reader.read.mockImplementationOnce(async () => { s.link.href = 'https://app.test/new'; return { done: false, value: new Uint8Array([1]) }; }); }
    expect(await s.run(s.command)).toMatchObject({ ok: false, error: { code: 'stale-result' } });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    if (stage === 'read') expect(r.reader.cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['headers', 'read'] as const)('deadline bounds noncooperative stalled %s and cleans resources', async stage => {
    vi.useFakeTimers(); const s = await setup(); const r = response();
    if (stage === 'headers') s.fetch.mockImplementation(() => new Promise(() => {}));
    else { s.fetch.mockResolvedValue(r.value); r.reader.read.mockImplementation(() => new Promise(() => {})); r.reader.cancel.mockImplementation(() => new Promise(() => {})); }
    const pending = s.run(s.command);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ ok: true, value: { state: 'failed', reason: 'timeout' } });
    expect(s.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    if (stage === 'read') expect(r.reader.cancel).toHaveBeenCalledTimes(1);
    const runtime = s.context.manifests.get('manifest:runtime:v1') as { controllers: Set<AbortController> };
    expect(runtime.controllers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a noncooperative response body that arrives after the deadline', async () => {
    vi.useFakeTimers(); const s = await setup();
    let finish!: (value: unknown) => void;
    s.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = s.run(s.command);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ value: { reason: 'timeout' } });
    const cancel = vi.fn(async () => {});
    finish({ ...response().value, body: { cancel } });
    await Promise.resolve(); await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['page', 'expiry', 'eviction'] as const)('rejects %s after an awaited body read without source', async change => {
    const s = await setup(); const r = response(); s.fetch.mockResolvedValue(r.value);
    r.reader.read.mockImplementationOnce(async () => {
      if (change === 'page') location.href += '?new';
      if (change === 'expiry') vi.setSystemTime(Date.now() + 60000);
      if (change === 'eviction') for (let i = 0; i < 8; i++) await s.run({ type: 'manifest:discover', expectedPage: s.command.expectedPage });
      return { done: false, value: new Uint8Array([1]) };
    });
    expect(await s.run(s.command)).toMatchObject({ ok: false, error: { code: change === 'page' ? 'stale-result' : 'stale-snapshot' } });
    expect(r.reader.cancel).toHaveBeenCalledTimes(1);
  });
  it('checks clock deadline in a hot zero-byte stream without collecting empty chunks', async () => {
    vi.useFakeTimers(); const s = await setup(); const r = response(); s.fetch.mockResolvedValue(r.value);
    r.reader.read.mockImplementation(async () => { vi.setSystemTime(Date.now() + 1000); return { done: false, value: new Uint8Array() }; });
    expect(await s.run(s.command)).toMatchObject({ ok: true, value: { state: 'failed', reason: 'timeout' } });
    expect(r.reader.read.mock.calls.length).toBeLessThanOrEqual(8);
    expect(r.reader.cancel).toHaveBeenCalledTimes(1);
  });
  it('dispose interrupts a stalled read as stale rather than timeout', async () => {
    const s = await setup(); const r = response(); s.fetch.mockResolvedValue(r.value);
    r.reader.read.mockImplementation(() => new Promise(() => {}));
    const pending = s.run(s.command);
    await vi.waitFor(() => expect(r.reader.read).toHaveBeenCalledTimes(1));
    s.events.dispatchEvent(new Event('pagehide'));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'stale-result' } });
    expect(r.reader.cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'data:application/json,{}', 'file:///m.json', 'not absolute'])('requires an honest HTTP(S) final response URL: %s', async url => {
    const s = await setup(); const r = response([], { url }); s.fetch.mockResolvedValue(r.value);
    expect(await s.run(s.command)).toMatchObject({ ok: true, value: { state: 'failed', reason: 'unreadable' } });
    expect(r.reader.read).not.toHaveBeenCalled();
  });
  it('keeps HTTP error metadata without reading a body', async () => {
    const s = await setup(); const r = response([], { status: 404 }); s.fetch.mockResolvedValue(r.value);
    expect(await s.run(s.command)).toMatchObject({ ok: true, value: { state: 'failed', reason: 'http-error', status: 404, readBytes: null } });
    expect(r.reader.read).not.toHaveBeenCalled();
  });
  it.each(['opaque', 'null-body'] as const)('reports %s as unreadable', async kind => {
    const s = await setup(); s.fetch.mockResolvedValue(response([], kind === 'opaque' ? { type: 'opaque', status: 0 } : { body: false }).value);
    expect(await s.run(s.command)).toMatchObject({ ok: true, value: { state: 'failed', reason: 'unreadable' } });
  });
  it('network rejection does not guess CORS and preserves unknown metadata', async () => {
    const s = await setup(); s.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await s.run(s.command)).toMatchObject({ ok: true, value: { state: 'failed', reason: 'network-error', status: null, finalURL: null, readBytes: null } });
  });
});
