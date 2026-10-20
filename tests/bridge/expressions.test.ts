import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createJobPollExpression, createJobStartExpression } from '../../src/bridge/expressions';
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
