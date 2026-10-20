import { describe, expect, it } from 'vitest';
import { createDiagnosticStore } from '../../src/ui/diagnostic-store.svelte';
import type { Overview, Result } from '../../src/domain/types';

const overview: Overview = {
  page: { documentId: 'private-document', origin: 'https://app.test', url: 'https://app.test/' },
  origin: 'https://one.test', registrations: [], controller: null, caches: [],
  storage: { usageBytes: null, quotaBytes: null }, warnings: [],
};

describe('diagnostic store', () => {
  it('distinguishes an empty origin from denied page access', async () => {
    const store = createDiagnosticStore(async () => ({ ok: true, value: overview }));
    await store.refresh();
    expect(store.state.overview?.registrations).toEqual([]);
    expect(store.state.error).toBeNull();
  });

  it('drops late results after navigation reset', async () => {
    let resolve!: (value: Result<Overview>) => void;
    const store = createDiagnosticStore(() => new Promise((done) => { resolve = done; }));
    const pending = store.refresh();
    store.resetForNavigation('https://two.test');
    resolve({ ok: true, value: overview });
    await pending;
    expect(store.state.origin).toBe('https://two.test');
    expect(store.state.overview).toBeNull();
  });
});
