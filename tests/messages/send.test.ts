import { afterEach, expect, it, vi } from 'vitest';
import { createPageContext } from '../../src/bridge/page-context';
import { createMessageRunner } from '../../src/messages/page-runner';
import { createMessageActions } from '../../src/messages/page-actions';
import { formatMessagePreview } from '../../src/messages/preview';
import { createControlRunner } from '../../src/actions/page-runner';
import type { ActionIntent } from '../../src/domain/actions';

async function setup(slot: 'active' | 'waiting' = 'active', jsonText = 'null') {
  vi.useFakeTimers(); vi.stubGlobal('location', { origin: 'https://app.test', href: 'https://app.test/' });
  vi.stubGlobal('addEventListener', vi.fn()); vi.stubGlobal('removeEventListener', vi.fn());
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
  return { context, page, intent, run, prepare, commit, postMessage, worker, registration, getRegistrations };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(['active', 'waiting'] as const)('post_once_without_application_ack %s', async slot => {
  const s = await setup(slot); const prepared = await s.prepare(); expect(s.postMessage).not.toHaveBeenCalled();
  expect(prepared).toMatchObject({ ok: true, value: { summary: expect.arrayContaining(['null', 'This sends data to website code and may change website state.']) } });
  if (!prepared.ok || !('ticketId' in prepared.value)) throw Error('prepare');
  const command = { type: 'commit-action' as const, expectedPage: s.page, ticketId: prepared.value.ticketId };
  expect(await s.run(command)).toMatchObject({ ok: true, value: { items: [{ outcome: 'applied', message: 'Message posted. Delivery is not confirmed.' }] } });
  await s.run(command); expect(s.postMessage.mock.calls).toEqual([[null]]);
  expect(s.context.messages.get(s.intent.kind === 'send-worker-message' ? s.intent.sessionId : '')).toMatchObject({ rows: [{ direction: 'outgoing', status: 'posted', text: 'null', requestId: expect.any(String) }] });
});
it.each(['true', '42', '"hello"', '[1]', '{"x":1}'])('sends parsed JSON without envelope %s', async text => { const s = await setup('active', text); await s.commit(); expect(s.postMessage.mock.calls).toEqual([[JSON.parse(text)]]); });
it.each(['{', '', ' '.repeat(16385), '"' + '😀'.repeat(4096) + '"'])('rejects malformed/oversize JSON', async text => { const s = await setup('active', text); expect(await s.commit()).toMatchObject({ ok: false, error: { code: 'invalid-command' } }); expect(s.postMessage).not.toHaveBeenCalled(); });
it.each(['worker', 'session', 'ttl', 'redundant', 'registration', 'page'])('rejects invalid %s before effect', async mode => {
  const s = await setup();
  if (mode === 'worker') s.intent = Object.assign(s.intent, { workerId: 'other' });
  if (mode === 'session') s.context.messages.delete((s.intent as Extract<ActionIntent, { kind: 'send-worker-message' }>).sessionId);
  if (mode === 'ttl') s.context.registrations.get('reg')!.expiresAt = Date.now();
  if (mode === 'redundant') s.worker.state = 'redundant';
  if (mode === 'registration') s.getRegistrations.mockResolvedValue([]);
  if (mode === 'page') location.href += 'changed';
  expect(await s.commit()).toMatchObject({ ok: false }); expect(s.postMessage).not.toHaveBeenCalled();
});
it.each(['slot', 'expiry', 'lookup-slot', 'lookup-page'])('revalidates commit %s', async mode => {
  const s = await setup(); const prepared = await s.prepare(); if (!prepared.ok || !('ticketId' in prepared.value)) throw Error('prepare');
  if (mode === 'slot') Object.assign(s.registration, { active: { ...s.worker } });
  if (mode === 'expiry') await vi.advanceTimersByTimeAsync(10000);
  if (mode.startsWith('lookup')) s.getRegistrations.mockImplementationOnce(async () => { if (mode === 'lookup-page') location.href += 'changed'; else Object.assign(s.registration, { active: { ...s.worker } }); return [s.registration]; });
  expect(await s.run({ type: 'commit-action', expectedPage: s.page, ticketId: prepared.value.ticketId })).toMatchObject({ ok: false }); expect(s.postMessage).not.toHaveBeenCalled();
});
it('reports a native throw locally without outgoing success row', async () => { const s = await setup(); s.postMessage.mockImplementation(() => { throw Error('secret'); }); expect(await s.commit()).toMatchObject({ ok: true, value: { items: [{ outcome: 'failed', message: 'Message could not be posted.' }] } }); expect(s.postMessage).toHaveBeenCalledOnce(); });

it('accepts the inclusive UTF-8 boundary and rejects a code-unit overflow before lookup', async () => {
  const s = await setup('active', '"' + 'x'.repeat(16382) + '"'); await s.commit(); expect(s.postMessage).toHaveBeenCalledOnce();
  Object.assign(s.intent, { jsonText: ' '.repeat(16385) }); s.getRegistrations.mockClear();
  expect(await s.prepare()).toMatchObject({ ok: false, error: { code: 'invalid-command' } }); expect(s.getRegistrations).not.toHaveBeenCalled();
});
it.each(['session', 'slot', 'registration', 'page'])('revalidates prepare after awaited lookup: %s', async mode => {
  const s = await setup(); s.getRegistrations.mockImplementationOnce(async () => {
    if (mode === 'session') s.context.messages.delete((s.intent as Extract<ActionIntent, { kind: 'send-worker-message' }>).sessionId);
    if (mode === 'slot') Object.assign(s.registration, { active: { ...s.worker } });
    if (mode === 'registration') s.context.registrations.delete('reg');
    if (mode === 'page') location.href += 'changed';
    return [s.registration];
  });
  expect(await s.prepare()).toMatchObject({ ok: false, error: { code: 'stale-target' } }); expect(s.postMessage).not.toHaveBeenCalled();
});
