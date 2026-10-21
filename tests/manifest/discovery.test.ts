import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageContext } from '../../src/bridge/page-context';
import { createManifestRunner } from '../../src/manifest/page-runner';
import type { ManifestDiscovery } from '../../src/manifest/types';
import type { Result } from '../../src/domain/types';

function setup(links: Array<{ rel: string; href?: string; crossOrigin?: string | null; referrerPolicy?: string }> = [], base = 'https://app.test/path/') {
  const events = new EventTarget();
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
  vi.stubGlobal('location', { origin: 'https://app.test', href: 'https://app.test/page' });
  const elements = links.map(link => ({
    getAttribute: (name: string) => name === 'href' ? link.href ?? null : null,
    get href() { try { return new URL(link.href ?? '', base).href; } catch { return link.href ?? ''; } },
    crossOrigin: link.crossOrigin ?? null, referrerPolicy: link.referrerPolicy ?? '',
  }));
  const querySelectorAll = vi.fn((selector: string) => {
    expect(selector).toBe('link[rel~="manifest" i]');
    return elements.filter((_, index) => links[index].rel.split(/[\t\n\f\r ]+/).some(token => token.toLowerCase() === 'manifest'));
  });
  vi.stubGlobal('document', { querySelectorAll });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const context = createPageContext(`manifest-${crypto.randomUUID()}`);
  const run = createManifestRunner(context);
  const expectedPage = context.identity();
  async function discover() {
    const result = await run({ type: 'manifest:discover', expectedPage }) as Result<ManifestDiscovery>;
    if (!result.ok) throw new Error(result.error.message);
    expect(fetch).not.toHaveBeenCalled();
    return result.value;
  }
  return { context, run, expectedPage, discover, fetch, events, elements };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('manifest discovery', () => {
  it('absent manifest has no snapshot and no network', async () => {
    const s = setup();
    expect(await s.discover()).toEqual({ page: s.expectedPage, snapshotId: null, linkCount: 0, link: null });
  });
  it('keeps the first matching link even when invalid and the second is valid', async () => {
    const s = setup([{ rel: 'manifest', href: 'http://[' }, { rel: 'manifest', href: '/valid.json' }]);
    expect(await s.discover()).toMatchObject({ linkCount: 2, snapshotId: expect.any(String), link: { href: 'http://[', url: null, issue: 'invalid-url' } });
  });
  it('uses DOM resolution with base URL while retaining raw href and link policies', async () => {
    const s = setup([{ rel: 'manifest', href: '../m.json', crossOrigin: 'use-credentials', referrerPolicy: 'no-referrer' }], 'https://cdn.test/assets/base/');
    expect((await s.discover()).link).toEqual({ href: '../m.json', url: 'https://cdn.test/assets/m.json', crossOrigin: 'use-credentials', referrerPolicy: 'no-referrer', issue: null });
  });
  it('matches rel tokens ASCII case-insensitively without substring matches', async () => {
    const s = setup([{ rel: 'notmanifest', href: '/wrong' }, { rel: 'alternate MANIFEST', href: '/right' }]);
    expect(await s.discover()).toMatchObject({ linkCount: 1, link: { url: 'https://app.test/right' } });
  });
  it.each([undefined, '', '   '])('preserves missing/empty first href %s', async href => {
    const s = setup([{ rel: 'manifest', href }, { rel: 'manifest', href: '/valid.json' }]);
    expect((await s.discover()).link).toMatchObject({ href: href ?? null, url: null, issue: href === undefined ? 'missing-href' : 'empty-href' });
  });
  it.each(['data:application/json,{}', 'blob:https://app.test/id', 'file:///manifest.json', 'ftp://app.test/m', 'https://name:password@app.test/m'])('marks %s unsupported without network', async href => {
    const s = setup([{ rel: 'manifest', href }]);
    const found = await s.discover();
    expect(found.link?.issue).toBe('unsupported-url');
    await expect(s.run({ type: 'manifest:fetch', expectedPage: s.expectedPage, snapshotId: found.snapshotId! })).resolves.toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('rejects a stale page before discovery or snapshot creation', async () => {
    const s = setup([{ rel: 'manifest', href: '/m.json' }]);
    location.href += '?changed';
    await expect(s.run({ type: 'manifest:discover', expectedPage: s.expectedPage })).resolves.toMatchObject({ ok: false, error: { code: 'stale-result' } });
    expect(s.context.manifests.size).toBe(0);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('expires snapshots at 60 seconds and evicts the oldest ninth discovery', async () => {
    vi.useFakeTimers();
    const s = setup([{ rel: 'manifest', href: '/m.json' }]);
    const first = await s.discover();
    for (let i = 0; i < 8; i++) await s.discover();
    const runtime = s.context.manifests.get('manifest:runtime:v1') as { snapshots: Map<string, unknown> };
    expect(runtime.snapshots.size).toBe(8);
    expect(runtime.snapshots.has(first.snapshotId!)).toBe(false);
    await expect(s.run({ type: 'manifest:fetch', expectedPage: s.expectedPage, snapshotId: first.snapshotId! })).resolves.toMatchObject({ ok: false, error: { code: 'stale-snapshot' } });
    const fresh = await s.discover();
    await vi.advanceTimersByTimeAsync(60000);
    await expect(s.run({ type: 'manifest:fetch', expectedPage: s.expectedPage, snapshotId: fresh.snapshotId! })).resolves.toMatchObject({ ok: false, error: { code: 'stale-snapshot' } });
    expect(runtime.snapshots.size).toBe(0);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('retains exact DOM references in one runtime and disposes snapshots/controllers once', async () => {
    const s = setup([{ rel: 'manifest', href: '/m.json' }]);
    const onDispose = vi.spyOn(s.context, 'onDispose');
    const first = await s.discover();
    const runtime = s.context.manifests.get('manifest:runtime:v1') as { snapshots: Map<string, { element: unknown }>; controllers: Set<AbortController> };
    expect(runtime.snapshots.get(first.snapshotId!)?.element).toBe(s.elements[0]);
    await createManifestRunner(s.context)({ type: 'manifest:discover', expectedPage: s.expectedPage });
    expect(s.context.manifests.get('manifest:runtime:v1')).toBe(runtime);
    expect(onDispose).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); runtime.controllers.add(controller);
    s.events.dispatchEvent(new Event('pagehide'));
    expect(controller.signal.aborted).toBe(true);
    expect(runtime.snapshots.size).toBe(0);
    expect(runtime.controllers.size).toBe(0);
    expect(s.context.manifests.size).toBe(0);
    await expect(s.run({ type: 'manifest:discover', expectedPage: s.expectedPage })).resolves.toMatchObject({ ok: false, error: { code: 'stale-result' } });
    expect(s.context.manifests.size).toBe(0);
  });
});
