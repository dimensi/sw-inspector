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
  expect(await run({ ...prepare, intent: { kind: 'delete-all-caches' } })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  const ticket = (await run(prepare)).value;
  expect(ticket.summary).toEqual(['Origin: https://example.test', `Cache: ${hostile}`, 'Cached responses will be removed. The site may recreate this cache.']);
  const commit = { type: 'commit-action', expectedPage: page, ticketId: ticket.ticketId } as const;
  const receipt = await run(commit);
  expect(receipt).toMatchObject({ ok: true, value: { status: 'completed', items: [{ target: hostile, outcome: 'applied' }] } });
  expect(await run(commit)).toEqual(receipt);
  expect(realm.effects).toBe(1);
});
