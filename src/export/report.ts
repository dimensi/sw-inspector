import type { CacheDetails, CacheInventory, CacheMeasurement, OfflineCheck, Overview } from '../domain/types';

type ReportInput = {
  timestamp: string;
  userAgent: string;
  overview: Overview;
  inventories: CacheInventory[];
  measurements: CacheMeasurement[];
  checks: OfflineCheck[];
  details?: CacheDetails[];
};

export function buildReport(input: ReportInput): string {
  const inventories = input.inventories.map(({ snapshotId: _snapshotId, ...inventory }) => inventory);
  const report = {
    schemaVersion: 1,
    timestamp: input.timestamp,
    userAgent: input.userAgent,
    origin: input.overview.origin,
    overview: input.overview,
    inventories,
    measurements: input.measurements,
    offlineChecks: input.checks,
    warnings: [
      'URLs and response headers can contain sensitive data. Review before sharing.',
      'Response bodies and previews are intentionally excluded from this report.',
    ],
  };
  return JSON.stringify(report, null, 2);
}
