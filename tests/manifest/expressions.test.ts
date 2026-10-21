import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createJobPollExpression, createJobStartExpression } from '../../src/bridge/expressions';
import type { InspectorCommand } from '../../src/domain/commands';

function fixture() {
  const events = new EventTarget();
  let now = Date.now();
  const raw = 'manifest"\n</script>;globalThis.injected=true';
  const link = { raw, href: 'https://app.test/assets/m.json', crossOrigin: null, referrerPolicy: '', getAttribute() { return this.raw; } };
  const fetch = vi.fn(async () => {
    const response = new Response('{"name":"</script><img src=x onerror=globalThis.injected=true>"}', { headers: { 'content-type': 'application/manifest+json' } });
    Object.defineProperty(response, 'url', { value: 'https://app.test/redirect/final.json' });
    return response;
  });
  const realm = { crypto, navigator: {}, Date: { now: () => now }, URL, AbortController, TextDecoder,
    location: { origin: 'https://app.test', href: 'https://app.test/page' },
    document: { querySelectorAll: () => [link] }, fetch,
    setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let sequence = 0;
  async function run(command: InspectorCommand) {
    const id = `manifest-roundtrip-${++sequence}`;
    const source = createJobStartExpression(command, id);
    expect(source).not.toContain('</script>');
    expect(JSON.parse(runInNewContext(source, realm))).toEqual({ jobId: id });
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
      const reply = JSON.parse(runInNewContext(createJobPollExpression(id), realm));
      if (reply.state === 'pending') continue;
      expect(reply.state).toBe('complete');
      return { result: reply.result, id };
    }
    throw new Error('Manifest job did not settle');
  }
  return { run, realm, fetch, link, events, expire: () => { now += 60000; } };
}

describe('manifest expression routing', () => {
  it('round-trips discovery and bounded fetch from fresh realm with shared identity and hostile data', async () => {
    const s = fixture();
    const page = (await s.run({ type: 'page-context' })).result.value;
    const discovery = (await s.run({ type: 'manifest:discover', expectedPage: page })).result;
    expect(discovery).toMatchObject({ ok: true, value: { page, link: { href: s.link.raw, url: s.link.href }, snapshotId: expect.any(String) } });
    expect(s.fetch).not.toHaveBeenCalled();
    const loaded = await s.run({ type: 'manifest:fetch', expectedPage: page, snapshotId: discovery.value.snapshotId });
    expect(loaded.result).toMatchObject({ ok: true, value: { page, state: 'loaded', finalURL: 'https://app.test/redirect/final.json', text: expect.stringContaining('</script><img') } });
    expect(JSON.parse(runInNewContext(createJobPollExpression(loaded.id), s.realm))).toEqual({ state: 'missing' });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(s.realm).not.toHaveProperty('injected');
    expect((await s.run({ type: 'manifest:unknown' } as unknown as InspectorCommand)).result).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['expired', 'changed-link', 'disposed'] as const)('keeps %s snapshot from starting a fetch in serialized jobs', async change => {
    const s = fixture();
    const page = (await s.run({ type: 'page-context' })).result.value;
    const discovery = (await s.run({ type: 'manifest:discover', expectedPage: page })).result.value;
    if (change === 'expired') s.expire();
    if (change === 'changed-link') s.link.raw += 'changed';
    if (change === 'disposed') s.events.dispatchEvent(new Event('pagehide'));
    expect((await s.run({ type: 'manifest:fetch', expectedPage: page, snapshotId: discovery.snapshotId })).result).toMatchObject({ ok: false, error: { code: change === 'expired' ? 'stale-snapshot' : 'stale-result' } });
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('does not publish source when identity changes during a serialized fetch', async () => {
    const s = fixture();
    const page = (await s.run({ type: 'page-context' })).result.value;
    const discovery = (await s.run({ type: 'manifest:discover', expectedPage: page })).result.value;
    const original = s.fetch.getMockImplementation()!;
    s.fetch.mockImplementationOnce(async () => { const response = await original(); s.realm.location.href += '?new'; return response; });
    expect((await s.run({ type: 'manifest:fetch', expectedPage: page, snapshotId: discovery.snapshotId })).result).toMatchObject({ ok: false, error: { code: 'stale-result' } });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });
});
