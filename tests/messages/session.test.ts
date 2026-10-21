import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageContext } from '../../src/bridge/page-context';
import { createMessageRunner } from '../../src/messages/page-runner';
import { formatMessagePreview } from '../../src/messages/preview';
import type { MessageSessionRecord } from '../../src/messages/session-types';
import type { MessageBatch, MessageSession } from '../../src/messages/types';
import type { Result } from '../../src/domain/types';

function setup() {
  vi.useFakeTimers();
  const events = new EventTarget(); const sw = new EventTarget();
  const add = vi.spyOn(sw, 'addEventListener'); const remove = vi.spyOn(sw, 'removeEventListener');
  const onmessage = vi.fn(); Object.assign(sw, { onmessage });
  vi.stubGlobal('navigator', { serviceWorker: sw });
  vi.stubGlobal('location', { origin: 'https://app.test', href: 'https://app.test/page' });
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events)); vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
  const context = createPageContext(`messages-${crypto.randomUUID()}`);
  const run = createMessageRunner(context, formatMessagePreview); const expectedPage = context.identity();
  async function open() { const result = await run({ type: 'open-message-session', expectedPage }) as Result<MessageSession>; if (!result.ok) throw Error(result.error.message); return result.value; }
  return { context, run, expectedPage, open, sw, add, remove, onmessage, events };
}
function item(text = 'x', sourceURL: string | null = null) { return { direction: 'incoming' as const, sourceURL, requestId: null, text, truncated: false, status: 'received' as const }; }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('message sessions', () => {
  it('open has no listeners/history/send and start owns listeners once without replacing onmessage', async () => {
    const s = setup(); const session = await s.open();
    expect(s.add).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) expect(await s.run({ type: 'start-message-listener', expectedPage: s.expectedPage, sessionId: session.sessionId })).toMatchObject({ ok: true });
    expect(s.add.mock.calls.map(call => call[0])).toEqual(['message', 'messageerror']);
    expect((s.sw as unknown as { onmessage: unknown }).onmessage).toBe(s.onmessage);
    const event = new MessageEvent('message', { data: { hello: '</script>' } });
    const ports = vi.fn(() => { throw Error('foreign ports forbidden'); }); Object.defineProperty(event, 'ports', { get: ports });
    s.sw.dispatchEvent(event);
    const result = await s.run({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: 0 }) as Result<MessageBatch>;
    expect(result).toMatchObject({ ok: true, value: { listening: true, nextSeq: 1, records: [{ seq: 1, requestId: null, status: 'received', text: '{"hello":"</script>"}' }] } });
    expect(ports).not.toHaveBeenCalled();
  });
  it('evicts at 500 rows with monotonic seq and cumulative dropped', async () => {
    const s = setup(); const session = await s.open(); const record = s.context.messages.get(session.sessionId) as MessageSessionRecord;
    for (let i = 0; i < 510; i++) record.append(item());
    expect(record.rows).toHaveLength(500); expect(record.rows[0].seq).toBe(11); expect(record.nextSeq).toBe(510); expect(record.dropped).toBe(10);
    const result = await s.run({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: 0 }) as Result<MessageBatch>;
    expect(result).toMatchObject({ value: { dropped: 10, nextSeq: 60, records: expect.any(Array) } });
    if (result.ok) expect(result.value.records).toHaveLength(50);
  });
  it('bounds 2 MiB ring and 128 KiB batches without skipping backlog', async () => {
    const s = setup(); const session = await s.open(); const record = s.context.messages.get(session.sessionId) as MessageSessionRecord;
    for (let i = 0; i < 300; i++) record.append(item('x'.repeat(16384)));
    expect(record.byteCount).toBeLessThanOrEqual(2 * 1024 * 1024); expect(record.dropped).toBeGreaterThan(0);
    let cursor = 0; const seen: number[] = [];
    while (true) {
      const result = await s.run({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: cursor }) as Result<MessageBatch>;
      if (!result.ok) throw Error(result.error.message);
      expect(result.value.records.length).toBeLessThanOrEqual(50);
      expect(result.value.records.reduce((sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).byteLength, 0)).toBeLessThanOrEqual(128 * 1024);
      if (!result.value.records.length) { expect(result.value.nextSeq).toBe(cursor); break; }
      seen.push(...result.value.records.map(row => row.seq)); cursor = result.value.nextSeq;
    }
    expect(seen).toEqual(record.rows.map(row => row.seq));
  });
  it('drops an oversized source URL before whole serialization, then returns later small rows', async () => {
    const s = setup(); const session = await s.open(); const record = s.context.messages.get(session.sessionId) as MessageSessionRecord;
    const stringify = vi.spyOn(JSON, 'stringify');
    record.append(item('data', 'x'.repeat(10 * 1024 * 1024)));
    expect(stringify).not.toHaveBeenCalled(); stringify.mockRestore();
    record.append(item('small'));
    const result = await s.run({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: 0 });
    expect(result).toMatchObject({ value: { dropped: 1, nextSeq: 2, records: [{ seq: 2, text: 'small' }] } });
  });
  it('keeps one timer/dispose owner across recreated factories, and expires even without stop', async () => {
    const s = setup(); const onDispose = vi.spyOn(s.context, 'onDispose'); let session = await s.open();
    for (let i = 0; i < 20; i++) { await createMessageRunner(s.context, formatMessagePreview)({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: 0 }); expect(vi.getTimerCount()).toBe(1); }
    expect(onDispose).toHaveBeenCalledTimes(1);
    await s.run({ type: 'start-message-listener', expectedPage: s.expectedPage, sessionId: session.sessionId });
    const record = s.context.messages.get(session.sessionId) as MessageSessionRecord; const close = vi.fn(); record.ports.add({ close } as unknown as MessagePort);
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.context.messages.has(session.sessionId)).toBe(false); expect(close).toHaveBeenCalledOnce(); expect(s.remove).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    expect(await s.run({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: 0 })).toMatchObject({ ok: false, error: { code: 'stale-target' } });
    session = await s.open(); s.events.dispatchEvent(new Event('pagehide')); expect(s.context.messages.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('replaces a prior session and stop cleans only owned listeners', async () => {
    const s = setup(); const foreign = vi.fn(); s.sw.addEventListener('message', foreign); const first = await s.open();
    await s.run({ type: 'start-message-listener', expectedPage: s.expectedPage, sessionId: first.sessionId });
    const second = await s.open(); expect(s.context.messages.has(first.sessionId)).toBe(false);
    expect(await s.run({ type: 'stop-message-session', expectedPage: s.expectedPage, sessionId: second.sessionId })).toEqual({ ok: true, value: { stopped: true } });
    s.sw.dispatchEvent(new MessageEvent('message', { data: 1 })); expect(foreign).toHaveBeenCalledTimes(1);
  });
  it('isolates another context and rejects stale document or invalid cursor without renewal', async () => {
    const s = setup(); const session = await s.open();
    const other = createPageContext(`messages-${crypto.randomUUID()}`);
    expect(await createMessageRunner(other, formatMessagePreview)({ type: 'read-message-events', expectedPage: other.identity(), sessionId: session.sessionId, afterSeq: 0 })).toMatchObject({ ok: false, error: { code: 'stale-target' } });
    expect(await s.run({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: -1 })).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
    location.href += '?new'; expect(await s.run({ type: 'read-message-events', expectedPage: s.expectedPage, sessionId: session.sessionId, afterSeq: 0 })).toMatchObject({ ok: false, error: { code: 'stale-target' } });
  });
});
