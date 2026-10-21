import { afterEach, expect, it, vi } from 'vitest';
import { createPageContext } from '../../src/bridge/page-context';
import { createMessageRunner } from '../../src/messages/page-runner';
import { createMessageActions } from '../../src/messages/page-actions';
import { formatMessagePreview } from '../../src/messages/preview';
import { createControlRunner } from '../../src/actions/page-runner';
import type { ActionIntent } from '../../src/domain/actions';

async function setup(slot: 'active' | 'waiting' = 'active', jsonText = 'null') {
  vi.useFakeTimers(); vi.stubGlobal('location', { origin: 'https://app.test', href: 'https://app.test/' });
  const events = new EventTarget(); vi.stubGlobal('addEventListener', events.addEventListener.bind(events)); vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
  const postMessage = vi.fn(); const worker = { scriptURL: 'https://app.test/sw.js', state: 'activated', postMessage };
  const registration = { scope: 'https://app.test/', [slot]: worker } as unknown as ServiceWorkerRegistration;
  const getRegistrations = vi.fn(async () => [registration]); vi.stubGlobal('navigator', { serviceWorker: { getRegistrations } });
  const context = createPageContext(crypto.randomUUID()); const page = context.identity();
  context.registrations.set('reg', { page, registration, expiresAt: Date.now() + 300000, workers: { [slot]: { workerId: 'worker', worker } } } as never);
  const opened = await createMessageRunner(context, formatMessagePreview)({ type: 'open-message-session', expectedPage: page });
  if (!opened.ok || !('sessionId' in opened.value)) throw Error('open');
  const sessionId = opened.value.sessionId;
  const intent: ActionIntent = { kind: 'send-worker-message', sessionId, registrationId: 'reg', workerId: 'worker', slot, jsonText, reply: 'none' };
  const run = createControlRunner(context, createMessageActions(context, formatMessagePreview));
  const prepare = () => run({ type: 'prepare-action', expectedPage: page, intent });
  async function commit() { const prepared = await prepare(); if (!prepared.ok || !('ticketId' in prepared.value)) return prepared; return run({ type: 'commit-action', expectedPage: page, ticketId: prepared.value.ticketId }); }
  return { context, page, intent, run, prepare, commit, postMessage, worker, registration, getRegistrations, events };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

class Port extends EventTarget {
  close = vi.fn(); start = vi.fn();
  send(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: value })); }
}
function channelMock() {
  const channels: { port1: Port; port2: Port }[] = [];
  vi.stubGlobal('MessageChannel', class { port1 = new Port(); port2 = new Port(); constructor() { channels.push(this); } });
  return channels;
}
async function sending() {
  const s = await setup(); const channels = channelMock(); Object.assign(s.intent, { reply: 'port' });
  const session = s.context.messages.get((s.intent as Extract<ActionIntent, { kind: 'send-worker-message' }>).sessionId) as import('../../src/messages/session-types').MessageSessionRecord;
  return { ...s, channels, session };
}
it('installs listener before raw post, correlates first immediate reply, and returns without waiting', async () => {
  const s = await sending(); s.postMessage.mockImplementation((value, transfer) => { expect(value).toBeNull(); expect(transfer).toEqual([s.channels[0].port2]); s.channels[0].port1.send({ answer: 42 }); });
  expect(await s.commit()).toMatchObject({ ok: true, value: { items: [{ outcome: 'applied', message: 'Message posted. Delivery is not confirmed.' }] } });
  const reply = s.session.rows.find(row => row.direction === 'reply')!; const outgoing = s.session.rows.find(row => row.direction === 'outgoing')!;
  expect(reply).toMatchObject({ text: '{"answer":42}', status: 'received', requestId: outgoing.requestId });
  s.channels[0].port1.send('duplicate'); expect(s.session.rows.filter(row => row.direction === 'reply')).toHaveLength(1);
  expect(s.channels[0].port1.close).toHaveBeenCalledOnce(); expect(s.session.ports.size).toBe(0); expect(s.session.cleanups.size).toBe(0);
  expect(vi.getTimerCount()).toBe(1);
});
it('accepts reply at 4999ms and closes owned timer', async () => {
  const s = await sending(); await s.commit(); expect(s.session.rows).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(4999); s.channels[0].port1.send('</script>');
  expect(s.session.rows[1]).toMatchObject({ direction: 'reply', status: 'received', text: '"</script>"' });
  await vi.advanceTimersByTimeAsync(1); expect(s.session.rows).toHaveLength(2); expect(s.channels[0].port1.close).toHaveBeenCalledOnce();
});
it('times out at 5000ms honestly and ignores late replies', async () => {
  const s = await sending(); await s.commit(); await vi.advanceTimersByTimeAsync(5000);
  expect(s.session.rows[1]).toMatchObject({ direction: 'system', status: 'reply-timeout', requestId: s.session.rows[0].requestId, text: 'No reply on the supplied port within 5 seconds. The message may have been handled.' });
  s.channels[0].port1.send('late'); expect(s.session.rows).toHaveLength(2); expect(s.channels[0].port1.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
});
it('handles messageerror once and closes owned resources', async () => {
  const s = await sending(); await s.commit(); s.channels[0].port1.dispatchEvent(new MessageEvent('messageerror'));
  expect(s.session.rows[1]).toMatchObject({ direction: 'reply', status: 'message-error', requestId: s.session.rows[0].requestId });
  await vi.advanceTimersByTimeAsync(5000); s.channels[0].port1.send('late'); expect(s.session.rows).toHaveLength(2); expect(s.channels[0].port1.close).toHaveBeenCalledOnce();
});
it('transfer throw closes both available endpoints and creates no posted/reply row', async () => {
  const s = await sending(); s.postMessage.mockImplementation(() => { throw Error('DataCloneError'); });
  expect(await s.commit()).toMatchObject({ ok: true, value: { items: [{ outcome: 'failed' }] } });
  expect(s.channels[0].port1.close).toHaveBeenCalledOnce(); expect(s.channels[0].port2.close).toHaveBeenCalledOnce();
  expect(s.session.rows).toHaveLength(0); expect(s.session.ports.size).toBe(0); expect(s.session.cleanups.size).toBe(0); expect(vi.getTimerCount()).toBe(1);
});
it.each(['stop', 'expiry', 'dispose'])('%s clears pending owned port and timer', async mode => {
  const s = await sending(); if (mode === 'expiry') await vi.advanceTimersByTimeAsync(9000); await s.commit();
  if (mode === 'stop') await createMessageRunner(s.context, formatMessagePreview)({ type: 'stop-message-session', expectedPage: s.page, sessionId: s.session.id });
  if (mode === 'expiry') await vi.advanceTimersByTimeAsync(1000);
  if (mode === 'dispose') s.events.dispatchEvent(new Event('pagehide'));
  expect(s.channels[0].port1.close).toHaveBeenCalledOnce(); expect(s.session.ports.size).toBe(0);
  s.channels[0].port1.send('late'); expect(s.session.rows.filter(row => row.direction === 'reply')).toHaveLength(0);
});
it('plain_client_message_is_not_correlated', async () => {
  const s = await sending(); const container = new EventTarget(); Object.assign(container, { getRegistrations: s.getRegistrations }); vi.stubGlobal('navigator', { serviceWorker: container });
  const run = createMessageRunner(s.context, formatMessagePreview); await run({ type: 'start-message-listener', expectedPage: s.page, sessionId: s.session.id });
  await s.commit(); container.dispatchEvent(new MessageEvent('message', { data: { requestId: s.session.rows[0].requestId, reply: true } }));
  expect(s.session.rows[1]).toMatchObject({ direction: 'incoming', requestId: null }); expect(s.channels[0].port1.close).not.toHaveBeenCalled();
});
