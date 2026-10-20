import { describe, expect, it } from 'vitest';
import { deriveInspectionStatus } from '../../src/domain/inspection-status';
import type { Overview } from '../../src/domain/types';

const controlledOverview: Overview = {
  page: { documentId: 'private-document', origin: 'https://app.test', url: 'https://app.test/' },
  origin: 'https://app.example.test',
  registrations: [{ scope: 'https://app.example.test/', installing: null, waiting: null, active: { scriptURL: '/sw.js', state: 'activated' } }],
  controller: { scriptURL: '/sw.js', state: 'activated' },
  caches: [{ name: 'app-v1', entries: 42, partial: false }],
  storage: { usageBytes: 4_096, quotaBytes: 100_000 },
  warnings: [],
};

describe('inspection status', () => {
  it('directs the developer to scan before no origin data exists', () => {
    expect(deriveInspectionStatus(null, false, null)).toMatchObject({
      tone: 'idle', title: 'Ready to inspect', action: 'Run inspection',
    });
  });

  it('flags an uncontrolled page even when registrations exist', () => {
    expect(deriveInspectionStatus({ ...controlledOverview, controller: null }, false, null)).toMatchObject({
      tone: 'attention', title: 'No active controller', action: 'Inspect again',
    });
  });

  it('summarizes a controlled origin as ready for cache work', () => {
    expect(deriveInspectionStatus(controlledOverview, false, null)).toMatchObject({
      tone: 'healthy', title: 'Origin is controlled', action: 'Inspect again',
    });
  });
});
