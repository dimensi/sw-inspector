import { afterEach, expect, it, vi } from 'vitest';
import { createMessageSessionController, type MessageSessionState } from '../../src/ui/message-session-controller';
import type { MessageBatch, MessageRecord } from '../../src/messages/types';
const page = { documentId: 'doc', origin: 'https://app.test', url: 'https://app.test/' };
const session = { sessionId: 'session', page, expiresAt: 10000 };
function row(seq: number, text = 'null'): MessageRecord { return { seq, timestamp: 1, direction: 'incoming', sourceURL: null, requestId: null, text, truncated: false, status: 'received' }; }
function setup() {
  vi.useFakeTimers(); let state: MessageSessionState; let current: typeof page | null = page;
  const invoke = vi.fn(async (command: { type: string }): Promise<any> => ({ ok: true, value: command.type === 'open-message-session' ? session : command.type === 'read-message-events' ? { sessionId: session.sessionId, records: [], nextSeq: 0, dropped: 0, listening: false, expiresAt: 11000 } : command.type === 'start-message-listener' ? session : { stopped: true } }));
  const controller = createMessageSessionController({ invoke, getPage: () => current, onState: next => { state = next; } });
  return { controller, invoke, state: () => state!, navigate: () => { current = { ...page, url: page.url + 'next' }; } };
}
afterEach(() => vi.useRealTimers());
it('open starts reads immediately and keeps lease through confirmation without listening', async () => {
  const s = setup(); expect(s.invoke).not.toHaveBeenCalled(); await s.controller.open();
  expect(s.invoke.mock.calls.map(([command]) => command.type)).toEqual(['open-message-session', 'read-message-events']);
  await vi.advanceTimersByTimeAsync(31000); expect(s.invoke.mock.calls.filter(([c]) => c.type === 'read-message-events')).toHaveLength(32);
  expect(s.invoke.mock.calls.some(([c]) => c.type === 'start-message-listener')).toBe(false); s.controller.dispose();
});
it('polling and settlement read never overlap', async () => {
  const s = setup(); let resolve!: (value: unknown) => void;
  s.invoke.mockImplementation(async command => command.type === 'open-message-session' ? { ok: true, value: session } : new Promise(r => { resolve = r; }));
  await s.controller.open(); await vi.advanceTimersByTimeAsync(5000); const pending = s.controller.read();
  expect(s.invoke).toHaveBeenCalledTimes(2); resolve({ ok: true, value: { sessionId: 'session', records: [], nextSeq: 0, dropped: 0, listening: false, expiresAt: 20000 } }); await pending;
  s.controller.dispose();
});
it('start is opt-in, stop cancels polling, and restart opens a new session explicitly', async () => {
  const s = setup(); await s.controller.startListening(); expect(s.invoke.mock.calls.map(([c]) => c.type)).toContain('start-message-listener');
  expect(s.state().listening).toBe(true); await s.controller.stop(); expect(s.state().session).toBeNull(); const count = s.invoke.mock.calls.length;
  await vi.advanceTimersByTimeAsync(20000); expect(s.invoke).toHaveBeenCalledTimes(count); await s.controller.startListening(); expect(s.invoke.mock.calls.filter(([c]) => c.type === 'open-message-session')).toHaveLength(2); s.controller.dispose();
});
it('clear log keeps cursor and does not stop or replay old rows', async () => {
  const s = setup(); s.invoke.mockImplementation(async command => ({ ok: true, value: command.type === 'open-message-session' ? session : command.type === 'read-message-events' ? { sessionId: 'session', records: [row(1)], nextSeq: 1, dropped: 0, listening: false, expiresAt: 20000 } : { stopped: true } }));
  await s.controller.open(); await s.controller.read(); expect(s.state().rows).toHaveLength(1); s.controller.clearLog(); expect(s.state().rows).toHaveLength(0);
  await s.controller.read(); expect(s.state().rows).toHaveLength(0); expect(s.invoke.mock.calls.at(-1)![0]).toMatchObject({ afterSeq: 1 }); s.controller.dispose();
});
it('bounds retained panel rows at500/2MiB and keeps dropped visible', async () => {
  const s = setup(); let next = 0;
  s.invoke.mockImplementation(async command => { if (command.type === 'open-message-session') return { ok: true, value: session }; if (command.type !== 'read-message-events') return { ok: true, value: { stopped: true } }; const records = Array.from({ length: 50 }, () => row(++next, 'x'.repeat(16384))); return { ok: true, value: { sessionId: 'session', records, nextSeq: next, dropped: 3, listening: false, expiresAt: 20000 } satisfies MessageBatch }; });
  await s.controller.open(); for (let i = 0; i < 12; i++) await s.controller.read();
  expect(s.state().rows.length).toBeLessThanOrEqual(500); expect(s.state().rows.reduce((sum, r) => sum + new TextEncoder().encode(JSON.stringify(r)).length, 0)).toBeLessThanOrEqual(2 * 1024 * 1024); expect(s.state().dropped).toBeGreaterThan(3); s.controller.dispose();
});
it('permission/read failure stops lease renewal and clears stale session', async () => {
  const s = setup(); await s.controller.open(); await s.controller.read(); s.invoke.mockResolvedValueOnce({ ok: false, error: { code: 'evaluation-failed', message: 'Access denied' } }); await s.controller.read();
  expect(s.state()).toMatchObject({ session: null, listening: false, error: 'Access denied' }); const count = s.invoke.mock.calls.length; await vi.advanceTimersByTimeAsync(20000); expect(s.invoke).toHaveBeenCalledTimes(count);
});
it('late open after dispose is stopped and cannot publish or restart polling', async () => {
  const s = setup(); let resolve!: (value: unknown) => void; s.invoke.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = s.controller.open(); s.controller.dispose(); resolve({ ok: true, value: session }); expect(await pending).toBeNull(); expect(s.state().session).toBeNull(); expect(s.invoke.mock.calls.at(-1)![0].type).toBe('stop-message-session'); expect(vi.getTimerCount()).toBe(0);
});
it('navigation rejects old read publication and stops session', async () => {
  const s = setup(); await s.controller.open(); await s.controller.read(); s.navigate(); await s.controller.read(); expect(s.state().session).toBeNull(); expect(s.state().rows).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
});

it('caps small panel rows at500 independently of byte bound', async () => {
  const s = setup(); let next = 0;
  s.invoke.mockImplementation(async command => { if (command.type === 'open-message-session') return { ok: true, value: session }; if (command.type !== 'read-message-events') return { ok: true, value: { stopped: true } }; const records = Array.from({ length: 50 }, () => row(++next)); return { ok: true, value: { sessionId: 'session', records, nextSeq: next, dropped: 0, listening: false, expiresAt: 20000 } }; });
  await s.controller.open(); for (let i = 0; i < 11; i++) await s.controller.read(); expect(s.state().rows).toHaveLength(500); expect(s.state().dropped).toBeGreaterThan(0); s.controller.dispose();
});
it('suppresses a read completed after navigation and synchronously disposes polling', async () => {
  const s = setup(); await s.controller.open(); await s.controller.read(); let resolve!: (value: unknown) => void;
  s.invoke.mockImplementationOnce(() => new Promise(r => { resolve = r; })); const pending = s.controller.read();
  s.navigate(); resolve({ ok: true, value: { sessionId: 'session', records: [row(1)], nextSeq: 1, dropped: 0, listening: true, expiresAt: 20000 } }); await pending;
  expect(s.state()).toMatchObject({ session: null, rows: [], listening: false }); expect(vi.getTimerCount()).toBe(0);
});
