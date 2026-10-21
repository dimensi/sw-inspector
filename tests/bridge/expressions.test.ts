import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createJobPollExpression, createJobStartExpression } from '../../src/bridge/expressions';
import type { InspectorCommand } from '../../src/domain/commands';
import type { DiagnosticCommand } from '../../src/domain/types';

describe('DevTools expressions', () => {
  it('injects page context into start/poll in fresh realms without module imports', async () => {
    const timers: Array<() => void> = [];
    const createRealm = () => {
      const events = new EventTarget();
      return {
        crypto, location: { origin: 'https://example.test', href: 'https://example.test/path#hash' },
        navigator: {}, setTimeout: (callback: () => void) => timers.push(callback),
        addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      };
    };
    const first = createRealm();
    async function run(realm: ReturnType<typeof createRealm>, id: string, type: 'page-context' | 'overview') {
      expect(JSON.parse(runInNewContext(createJobStartExpression({ type }, id), realm))).toEqual({ jobId: id });
      let reply;
      do {
        await new Promise((resolve) => setImmediate(resolve));
        reply = JSON.parse(runInNewContext(createJobPollExpression(id), realm));
      } while (reply.state === 'pending');
      expect(reply.state).toBe('complete');
      expect(reply.result.ok).toBe(true);
      return reply.result.value;
    }
    const identity = await run(first, 'context-1', 'page-context');
    expect(identity).toMatchObject({ origin: first.location.origin, url: first.location.href });
    expect((await run(first, 'overview-1', 'overview')).page).toEqual(identity);
    expect((await run(first, 'context-2', 'page-context')).documentId).toBe(identity.documentId);
    expect((await run(createRealm(), 'context-3', 'page-context')).documentId).not.toBe(identity.documentId);
  });

  it('starts hostile command data in a synchronous, JSON-acknowledged page job', async () => {
    const command: DiagnosticCommand = {
      type: 'list-cache-keys',
      cacheName: 'cache "\n</script>\\\u2028\u2029привет',
    };

    const source = createJobStartExpression(command, 'job-1');
    vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('location', { origin: 'https://example.test', href: 'https://example.test/' });
    vi.stubGlobal('navigator', { serviceWorker: { controller: null, getRegistrations: async () => [] }, storage: { estimate: async () => ({}) } });
    vi.stubGlobal('caches', { keys: async () => [command.cacheName], open: async () => ({ keys: async () => [] }) });
    const evaluated = new Function(`return ${source}`)();
    expect(JSON.parse(evaluated)).toEqual({ jobId: 'job-1' });
    expect(source).not.toContain('</script>');
    expect(source).not.toContain('\u2028');
    expect(source).toContain('Promise.resolve().then');
    expect(createJobPollExpression('job-1')).toContain('job-1');
    vi.unstubAllGlobals();
  });
});

it('serializes control dependencies into a fresh realm and keeps hostile strings as data', async () => {
  const events = new EventTarget();
  const realm = { crypto, navigator: {}, location: { origin: 'https://example.test', href: 'https://example.test/' },
    setTimeout: () => 0, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), effects: 0, caches: { keys: async () => ['</script>\u2028\u2029'], delete: async () => { realm.effects++; return true; } } };
  let sequence = 0;
  async function run(command: InspectorCommand) {
    const id = `control-${++sequence}`;
    const production = createJobStartExpression(command, id);
    expect(production).not.toContain('globalThis.effects');
    runInNewContext(production, realm);
    await new Promise(resolve => setImmediate(resolve));
    return JSON.parse(runInNewContext(createJobPollExpression(id), realm)).result;
  }
  const page = (await run({ type: 'page-context' })).value;
  const hostile = '</script>\u2028\u2029';
  const prepare = { type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-cache', cacheName: hostile } } as const;
  expect(await run({ ...prepare, intent: { kind: 'delete-cache-entry', cacheName: hostile, requestKey: 'x:0' } })).toMatchObject({ ok: false, error: { code: 'stale-target' } });
  const ticket = (await run(prepare)).value;
  expect(ticket.summary).toEqual(['Origin: https://example.test', `Cache: ${hostile}`, 'Cached responses will be removed. The site may recreate this cache.']);
  const commit = { type: 'commit-action', expectedPage: page, ticketId: ticket.ticketId } as const;
  const receipt = await run(commit);
  expect(receipt).toMatchObject({ ok: true, value: { status: 'completed', items: [{ target: hostile, outcome: 'applied' }] } });
  expect(await run(commit)).toEqual(receipt);
  expect(realm.effects).toBe(1);
});

it('executes a frozen batch through serialized production dependencies in a fresh realm', async () => {
  const events = new EventTarget();
  const names = ['a', 'b', 'c'];
  const calls: string[] = [];
  const realm = { crypto, navigator: {}, location: { origin: 'https://batch.test', href: 'https://batch.test/' },
    setTimeout: () => 0, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    caches: { keys: async () => [...names], delete: async (name: string) => { calls.push(name); if (name === 'b') throw Error('denied'); return true; } } };
  let sequence = 0;
  async function run(command: InspectorCommand) {
    const id = `batch-${++sequence}`;
    runInNewContext(createJobStartExpression(command, id), realm);
    await new Promise(resolve => setImmediate(resolve));
    return JSON.parse(runInNewContext(createJobPollExpression(id), realm)).result;
  }
  const page = (await run({ type: 'page-context' })).value;
  const ticket = (await run({ type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-all-caches' } })).value;
  names.push('created-after-confirmation');
  const command = { type: 'commit-action', expectedPage: page, ticketId: ticket.ticketId } as const;
  const receipt = await run(command);
  expect(receipt).toMatchObject({ ok: true, value: { status: 'partial', items: [
    { target: 'a', outcome: 'applied' }, { target: 'b', outcome: 'failed' }, { target: 'c', outcome: 'applied' },
  ] } });
  expect(await run(command)).toEqual(receipt);
  expect(calls).toEqual(['a', 'b', 'c']);
});


it('retains Cache and Request across serialized inventory, preview, prepare and commit jobs', async () => {
  const events = new EventTarget();
  const requests = [new Request('https://entry.test/a', { headers: { 'Accept-Language': 'en' } }), new Request('https://entry.test/a', { headers: { 'Accept-Language': 'fr' } })];
  const remove = vi.fn(async () => true);
  const cache = { keys: async () => requests, match: async () => new Response('body', { headers: { 'content-type': 'text/plain' } }), delete: remove };
  const open = vi.fn(async () => cache);
  const realm = { crypto, navigator: {}, location: { origin: 'https://entry.test', href: 'https://entry.test/' },
    setTimeout: () => 0, TextDecoder, Date, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    caches: { keys: async () => ['a'], open } };
  let sequence = 0;
  async function run(command: InspectorCommand) {
    const id = `entry-${++sequence}`;
    runInNewContext(createJobStartExpression(command, id), realm);
    let reply;
    do { await new Promise(resolve => setImmediate(resolve)); reply = JSON.parse(runInNewContext(createJobPollExpression(id), realm)); } while (reply.state === 'pending');
    return reply.result;
  }
  const page = (await run({ type: 'page-context' })).value;
  const inventory = (await run({ type: 'list-cache-keys', cacheName: 'a' })).value;
  const requestKey = inventory.entries[1].requestKey;
  expect(await run({ type: 'get-response-details', cacheName: 'a', requestKey, preview: true })).toMatchObject({ ok: true, value: { preview: { text: 'body' } } });
  const ticket = (await run({ type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-cache-entry', cacheName: 'a', requestKey } })).value;
  expect(await run({ type: 'commit-action', expectedPage: page, ticketId: ticket.ticketId })).toMatchObject({ ok: true, value: { items: [{ target: 'GET https://entry.test/a', outcome: 'applied' }] } });
  expect(remove).toHaveBeenCalledExactlyOnceWith(requests[1]);
  expect(open).toHaveBeenCalledTimes(1);
  expect(await run({ type: 'get-response-details', cacheName: 'a', requestKey })).toMatchObject({ ok: false, error: { code: 'stale-snapshot' } });
});


it('worker handlers survive serialization and hostile scope/scriptURL remain data', async () => {
  const events = new EventTarget();
  const hostile = 'https://worker.test/"\n</script>;globalThis.injected=true';
  const registrations = ['first', hostile].map(scope => ({ scope, installing: null, waiting: null,
    active: { scriptURL: hostile, state: 'activated' }, update: vi.fn(async () => undefined), unregister: vi.fn(async () => true) }));
  const realm = { crypto, location: { origin: 'https://worker.test', href: 'https://worker.test/' },
    navigator: { serviceWorker: { controller: null, getRegistrations: async () => registrations } },
    setTimeout: () => 0, clearTimeout: () => {}, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let sequence = 0;
  async function run(command: InspectorCommand) {
    const id = `worker-${++sequence}`;
    const source = createJobStartExpression(command, id);
    expect(source).not.toContain('</script>');
    runInNewContext(source, realm);
    await new Promise(resolve => setImmediate(resolve));
    const reply = JSON.parse(runInNewContext(createJobPollExpression(id), realm));
    expect(reply.state).toBe('complete');
    return reply.result;
  }
  const overview = (await run({ type: 'overview' })).value;
  const page = overview.page;
  const registrationId = overview.registrations[1].registrationId;
  for (const kind of ['update-worker', 'unregister-worker'] as const) {
    const prepared = await run({ type: 'prepare-action', expectedPage: page, intent: { kind, registrationId } });
    expect(prepared.ok).toBe(true);
    expect(prepared.value.summary).toContain(hostile);
    expect(registrations[1][kind === 'update-worker' ? 'update' : 'unregister']).not.toHaveBeenCalled();
    const commit = { type: 'commit-action', expectedPage: page, ticketId: prepared.value.ticketId } as const;
    const receipt = await run(commit);
    expect(receipt).toMatchObject({ ok: true, value: { kind, items: [{ target: hostile, outcome: 'applied' }] } });
    expect(await run(commit)).toEqual(receipt);
  }
  expect(registrations[0].update).not.toHaveBeenCalled();
  expect(registrations[0].unregister).not.toHaveBeenCalled();
  expect(registrations[1].update).toHaveBeenCalledTimes(1);
  expect(registrations[1].unregister).toHaveBeenCalledTimes(1);
  expect(realm).not.toHaveProperty('injected');
});


it('serializes explicit message formatter/session runtime in fresh realm without sending', async () => {
  const events = new EventTarget(); const sw = new EventTarget();
  const add = vi.spyOn(sw, 'addEventListener'); const remove = vi.spyOn(sw, 'removeEventListener');
  const realm = { crypto, navigator: { serviceWorker: sw }, TextEncoder,
    location: { origin: 'https://messages.test', href: 'https://messages.test/' },
    setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let sequence = 0;
  async function run(command: InspectorCommand) {
    const id = `messages-${++sequence}`;
    expect(JSON.parse(runInNewContext(createJobStartExpression(command, id), realm))).toEqual({ jobId: id });
    await new Promise(resolve => setImmediate(resolve));
    const reply = JSON.parse(runInNewContext(createJobPollExpression(id), realm));
    expect(reply.state).toBe('complete'); return reply.result;
  }
  const page = (await run({ type: 'page-context' })).value;
  const opened = await run({ type: 'open-message-session', expectedPage: page });
  expect(opened.ok).toBe(true); expect(add).not.toHaveBeenCalled();
  const sessionId = opened.value.sessionId;
  await run({ type: 'start-message-listener', expectedPage: page, sessionId });
  await run({ type: 'start-message-listener', expectedPage: page, sessionId });
  expect(add).toHaveBeenCalledTimes(2);
  sw.dispatchEvent(new MessageEvent('message', { data: { html: '</script><img src=x>' } }));
  expect(await run({ type: 'read-message-events', expectedPage: page, sessionId, afterSeq: 0 })).toMatchObject({ ok: true, value: { nextSeq: 1, records: [{ text: '{"html":"</script><img src=x>"}', requestId: null }] } });
  expect(await run({ type: 'prepare-action', expectedPage: page, intent: { kind: 'send-worker-message', sessionId, registrationId: 'none', workerId: 'none', slot: 'active', jsonText: '{}', reply: 'none' } })).toMatchObject({ ok: false, error: { code: 'stale-target' } });
  expect(await run({ type: 'stop-message-session', expectedPage: page, sessionId })).toEqual({ ok: true, value: { stopped: true } });
  expect(remove).toHaveBeenCalledTimes(2);
});

it.each(['none', 'port'] as const)('serializes message action with raw hostile JSON and exactly one post (%s)', async replyMode => {
  const events = new EventTarget(); const postMessage = vi.fn();
  const worker = { scriptURL: 'https://messages.test/sw.js', state: 'activated', postMessage };
  const registration = { scope: 'https://messages.test/', active: worker, waiting: null, installing: null };
  const realm = { crypto, TextEncoder, MessageChannel, navigator: { serviceWorker: { getRegistrations: async () => [registration], controller: null }, storage: { estimate: async () => ({}) } },
    caches: { keys: async () => [] }, location: { origin: 'https://messages.test', href: 'https://messages.test/' },
    setTimeout: () => 0, clearTimeout: () => {}, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let seq = 0;
  async function run(command: InspectorCommand) {
    const id = `send-${++seq}`; runInNewContext(createJobStartExpression(command, id), realm);
    await new Promise(resolve => setImmediate(resolve));
    const reply = JSON.parse(runInNewContext(createJobPollExpression(id), realm)); expect(reply.state).toBe('complete'); return reply.result;
  }
  const overview = (await run({ type: 'overview' })).value; const page = overview.page;
  const selected = overview.registrations[0];
  const sessionId = (await run({ type: 'open-message-session', expectedPage: page })).value.sessionId;
  if (replyMode === 'port') postMessage.mockImplementation((_value, ports: MessagePort[]) => { ports[0].postMessage('reply'); ports[0].close(); });
  const payload = '</script>\u2028<img src=x>'; const prepared = await run({ type: 'prepare-action', expectedPage: page,
    intent: { kind: 'send-worker-message', sessionId, registrationId: selected.registrationId, workerId: selected.active.workerId, slot: 'active', jsonText: JSON.stringify(payload), reply: replyMode } });
  expect(postMessage).not.toHaveBeenCalled(); expect(prepared.ok).toBe(true);
  const commit = { type: 'commit-action' as const, expectedPage: page, ticketId: prepared.value.ticketId };
  expect(await run(commit)).toMatchObject({ ok: true, value: { items: [{ outcome: 'applied' }] } }); await run(commit);
  if (replyMode === 'none') expect(postMessage.mock.calls).toEqual([[payload]]);
  else {
    expect(postMessage).toHaveBeenCalledOnce(); expect(postMessage.mock.calls[0][0]).toBe(payload); expect(postMessage.mock.calls[0][1]).toHaveLength(1);
    let batch;
    for (let i = 0; i < 50; i++) { batch = await run({ type: 'read-message-events', expectedPage: page, sessionId, afterSeq: 0 }); if (batch.value.records.length === 2) break; }
    expect(batch).toMatchObject({ ok: true, value: { records: [expect.objectContaining({ direction: 'outgoing' }), expect.objectContaining({ direction: 'reply', text: '"reply"' })] } });
    expect(batch.value.records[0].requestId).toBe(batch.value.records[1].requestId);
  }
  expect(await run({ type: 'read-message-events', expectedPage: page, sessionId, afterSeq: 0 })).toMatchObject({ ok: true, value: { records: expect.arrayContaining([{ seq: expect.any(Number), timestamp: expect.any(Number), sourceURL: worker.scriptURL, requestId: expect.any(String), truncated: false, direction: 'outgoing', text: JSON.stringify(payload), status: 'posted' }]) } });
  await run({ type: 'stop-message-session', expectedPage: page, sessionId });
});
