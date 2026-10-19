import { describe, expect, it, vi } from 'vitest';
import { createJobPollExpression, createJobStartExpression } from '../../src/bridge/expressions';
import type { DiagnosticCommand } from '../../src/domain/types';

describe('DevTools expressions', () => {
  it('starts hostile command data in a synchronous, JSON-acknowledged page job', async () => {
    const command: DiagnosticCommand = {
      type: 'list-cache-keys',
      cacheName: 'cache "\n</script>\\\u2028\u2029привет',
    };

    const source = createJobStartExpression(command, 'job-1');
    vi.stubGlobal('location', { origin: 'https://example.test' });
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
