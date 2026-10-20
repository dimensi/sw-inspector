import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDiagnostic } from '../../src/diagnostics/page-runner';
import type { CacheMeasurement, Result } from '../../src/domain/types';

afterEach(() => vi.unstubAllGlobals());

describe('cache measurement', () => {
  it('sums readable bodies and preserves unknown opaque responses as unknown', async () => {
    const readable = new Response('abc');
    const opaque = new Response('hidden');
    Object.defineProperty(opaque, 'type', { value: 'opaque' });
    const records = [
      { request: new Request('https://app.test/a'), response: readable },
      { request: new Request('https://app.test/b'), response: opaque },
    ];
    vi.stubGlobal('addEventListener', vi.fn());
    vi.stubGlobal('removeEventListener', vi.fn());
    vi.stubGlobal('location', { origin: 'https://app.test', href: 'https://app.test/' });
    vi.stubGlobal('caches', {
      keys: async () => ['runtime'],
      open: async () => ({ keys: async () => records.map((item) => item.request), match: async (request: Request) => records.find((item) => item.request === request)?.response }),
    });
    const result = await executeDiagnostic({ type: 'measure-cache', cacheName: 'runtime' }) as Result<CacheMeasurement>;
    expect(result).toEqual({ ok: true, value: { cacheName: 'runtime', entries: 2, bodyBytes: 3, unknownEntries: 1, failedEntries: 0, complete: false } });
  });
});
