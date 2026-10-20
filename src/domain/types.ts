export type DiagnosticCommand =
  | { type: 'overview' }
  | { type: 'list-cache-keys'; cacheName: string }
  | { type: 'get-response-details'; cacheName: string; requestKey: string; preview?: boolean; fullPreview?: boolean }
  | { type: 'measure-cache'; cacheName: string }
  | { type: 'check-urls'; paths: string[] };

export type DiagnosticErrorCode =
  | 'aborted'
  | 'cache-not-found'
  | 'evaluation-failed'
  | 'malformed-result'
  | 'stale-snapshot'
  | 'stale-result'
  | 'timeout';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: DiagnosticErrorCode; message: string } };

export type WorkerState = { scriptURL: string; state: string };

export type Registration = {
  scope: string;
  installing: WorkerState | null;
  waiting: WorkerState | null;
  active: WorkerState | null;
};

export type StorageEstimate = { usageBytes: number | null; quotaBytes: number | null };

export type CacheSummary = { name: string; entries: number; partial: boolean };

export type Overview = {
  origin: string;
  registrations: Registration[];
  controller: WorkerState | null;
  caches: CacheSummary[];
  storage: StorageEstimate;
  warnings: string[];
};

export type CacheEntry = { requestKey: string; url: string; method: string; mode: string | null };

export type CacheInventory = {
  cacheName: string;
  snapshotId: string;
  entries: CacheEntry[];
  totalEntries: number;
  partial: boolean;
};

export type CacheDetails = {
  status: number | null;
  contentType: string | null;
  headers: Array<[string, string]>;
  preview: { kind: 'not-requested' | 'text' | 'opaque' | 'unavailable'; text?: string; truncated?: boolean };
};

export type CacheMeasurement = {
  cacheName: string;
  entries: number;
  bodyBytes: number;
  unknownEntries: number;
  failedEntries: number;
  complete: boolean;
};

export type OfflineCheck = {
  input: string;
  normalizedURL: string | null;
  found: boolean;
  status: number | null;
  contentType: string | null;
  error?: { code: 'invalid-url' | 'cache-unavailable'; message: string };
};
