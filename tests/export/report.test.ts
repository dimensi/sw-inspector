import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/export/report';

describe('buildReport', () => {
  it('exports metadata only and warns about sensitive URLs and headers', () => {
    const report = JSON.parse(buildReport({
      timestamp: '2026-10-19T12:00:00.000Z', userAgent: 'Safari',
      overview: {
        page: { documentId: 'private-document', origin: 'https://app.test', url: 'https://app.test/' },
  origin: 'https://app.test', registrations: [], controller: null, caches: [],
        storage: { usageBytes: null, quotaBytes: null }, warnings: [],
      },
      inventories: [{ cacheName: 'shell', snapshotId: 'private', totalEntries: 1, partial: false, entries: [{ requestKey: 'private:0', url: 'https://app.test/?token=secret', method: 'GET', mode: 'navigate' }] }],
      measurements: [], checks: [],
      details: [{ status: 200, contentType: 'text/plain', headers: [['authorization', 'secret']], preview: { kind: 'text', text: 'must not export' } }],
    }));
    expect(report.overview).not.toHaveProperty('page');
    expect(JSON.stringify(report)).not.toContain('private-document');
    expect(report.schemaVersion).toBe(1);
    expect(report.inventories[0].entries[0].url).toContain('token=secret');
    expect(JSON.stringify(report)).not.toContain('must not export');
    expect(JSON.stringify(report)).not.toContain('authorization');
    expect(report.warnings).toContain('URLs and response headers can contain sensitive data. Review before sharing.');
  });
});

it('exports explicit worker metadata without ephemeral handles or future payload fields', () => {
  const worker = { workerId: 'private-worker', scriptURL: 'https://app.test/sw.js', state: 'activated', payload: 'private-payload', rawSource: 'private-source' };
  const overview = { page: { documentId: 'private-doc', origin: 'https://app.test', url: 'https://app.test/' }, origin: 'https://app.test', registrations: [{ registrationId: 'private-registration', scope: 'https://app.test/', active: worker, waiting: null, installing: null, payload: 'private-payload' }], controller: worker, caches: [], storage: { usageBytes: null, quotaBytes: null }, warnings: [] };
  const raw = buildReport({ timestamp: 'now', userAgent: 'Safari', overview, inventories: [], measurements: [], checks: [] });
  const report = JSON.parse(raw); expect(report.overview.registrations).toEqual([{ scope: 'https://app.test/', active: { scriptURL: worker.scriptURL, state: 'activated' }, waiting: null, installing: null }]);
  expect(report.overview.controller).toEqual({ scriptURL: worker.scriptURL, state: 'activated' });
  for (const canary of ['private-worker', 'private-registration', 'private-payload', 'private-source', 'private-doc']) expect(raw).not.toContain(canary);
});
