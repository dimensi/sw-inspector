import type {
  CacheDetails,
  CacheEntry,
  CacheInventory,
  CacheMeasurement,
  DiagnosticCommand,
  OfflineCheck,
  Overview,
  Registration,
  Result,
  WorkerState,
} from '../domain/types';

export function createPageRunner(snapshotRegistryKey = '__swInspectorSnapshotsV1') {
const MAX_ENTRIES = 1_500;
const MAX_PREVIEW_BYTES = 48 * 1024;
const SNAPSHOT_TTL_MS = 5 * 60 * 1_000;
const MAX_SNAPSHOTS = 12;

type SnapshotRecord = { cacheName: string; requests: Request[]; expiresAt: number };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workerState(worker: ServiceWorker | null | undefined): WorkerState | null {
  return worker ? { scriptURL: worker.scriptURL, state: worker.state } : null;
}

function registry(): Map<string, SnapshotRecord> {
  const current = (globalThis as Record<string, unknown>)[snapshotRegistryKey];
  if (current instanceof Map) {
    for (const [id, record] of current.entries() as Iterable<[string, SnapshotRecord]>) {
      if (record.expiresAt <= Date.now()) current.delete(id);
    }
    return current as Map<string, SnapshotRecord>;
  }
  const created = new Map<string, SnapshotRecord>();
  (globalThis as Record<string, unknown>)[snapshotRegistryKey] = created;
  return created;
}

async function openExistingCache(name: string): Promise<Cache> {
  if (!('caches' in globalThis)) throw new Error('Cache Storage is unavailable');
  if (!(await caches.keys()).includes(name)) throw new Error('cache-not-found');
  return caches.open(name);
}

async function boundedText(response: Response): Promise<CacheDetails['preview']> {
  if (response.type === 'opaque') return { kind: 'opaque' };
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/i.test(contentType)) {
    return { kind: 'unavailable' };
  }
  if (!response.body) return { kind: 'unavailable' };
  const reader = response.clone().body?.getReader();
  if (!reader) return { kind: 'unavailable' };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (bytes <= MAX_PREVIEW_BYTES) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_PREVIEW_BYTES) return { kind: 'too-large' };
      chunks.push(next.value);
    }
    const merged = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { kind: 'text', text: new TextDecoder().decode(merged) };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function overview(): Promise<Result<Overview>> {
  const warnings: string[] = [];
  const registrations: Registration[] = [];
  let controller: WorkerState | null = null;
  if ('serviceWorker' in navigator) {
    try {
      controller = workerState(navigator.serviceWorker.controller);
      const found = await navigator.serviceWorker.getRegistrations();
      registrations.push(...found.map((registration) => ({
        scope: registration.scope,
        installing: workerState(registration.installing),
        waiting: workerState(registration.waiting),
        active: workerState(registration.active),
      })));
    } catch (error) {
      warnings.push(`Service Worker: ${message(error)}`);
    }
  } else {
    warnings.push('Service Worker API is unavailable in this page context');
  }

  const cacheSummaries: Overview['caches'] = [];
  if ('caches' in globalThis) {
    try {
      for (const name of await caches.keys()) {
        try {
          const cache = await openExistingCache(name);
          const count = (await cache.keys()).length;
          cacheSummaries.push({ name, entries: count, partial: count > MAX_ENTRIES });
        } catch (error) {
          warnings.push(`Cache ${name}: ${message(error)}`);
        }
      }
    } catch (error) {
      warnings.push(`Cache Storage: ${message(error)}`);
    }
  } else {
    warnings.push('Cache Storage is unavailable in this page context');
  }

  let storage: Overview['storage'] = { usageBytes: null, quotaBytes: null };
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      storage = { usageBytes: estimate.usage ?? null, quotaBytes: estimate.quota ?? null };
    } else {
      warnings.push('Storage estimate is unavailable in this page context');
    }
  } catch (error) {
    warnings.push(`Storage estimate: ${message(error)}`);
  }

  return { ok: true, value: { origin: location.origin, registrations, controller, caches: cacheSummaries, storage, warnings } };
}

async function listCacheKeys(cacheName: string): Promise<Result<CacheInventory>> {
  try {
    const cache = await openExistingCache(cacheName);
    const requests = await cache.keys();
    const snapshotId = crypto.randomUUID();
    const visibleRequests = requests.slice(0, MAX_ENTRIES);
    const snapshots = registry();
    while (snapshots.size >= MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(snapshotId, { cacheName, requests: visibleRequests, expiresAt: Date.now() + SNAPSHOT_TTL_MS });
    setTimeout(() => registry().delete(snapshotId), SNAPSHOT_TTL_MS);
    const entries: CacheEntry[] = visibleRequests.map((request, index) => ({
      requestKey: `${snapshotId}:${index}`,
      url: request.url,
      method: request.method,
      mode: request.mode || null,
    }));
    return { ok: true, value: { cacheName, snapshotId, entries, totalEntries: requests.length, partial: requests.length > visibleRequests.length } };
  } catch (error) {
    return { ok: false, error: { code: message(error) === 'cache-not-found' ? 'cache-not-found' : 'evaluation-failed', message: message(error) } };
  }
}

async function details(cacheName: string, requestKey: string, preview: boolean): Promise<Result<CacheDetails>> {
  const [snapshotId, rawIndex] = requestKey.split(':');
  const snapshot = registry().get(snapshotId);
  const index = Number(rawIndex);
  if (!snapshot || snapshot.cacheName !== cacheName || !Number.isInteger(index) || index < 0 || index >= snapshot.requests.length || snapshot.expiresAt < Date.now()) {
    registry().delete(snapshotId);
    return { ok: false, error: { code: 'stale-snapshot', message: 'Cache inventory expired; refresh the cache list' } };
  }
  try {
    const cache = await openExistingCache(cacheName);
    const response = await cache.match(snapshot.requests[index]);
    if (!response) return { ok: false, error: { code: 'stale-snapshot', message: 'Cached response changed; refresh the cache list' } };
    const result: Result<CacheDetails> = {
      ok: true,
      value: {
        status: response.type === 'opaque' ? null : response.status,
        contentType: response.headers.get('content-type'),
        headers: Array.from(response.headers.entries()),
        preview: preview ? await boundedText(response) : { kind: 'not-requested' },
      },
    };
    if (preview) registry().delete(snapshotId);
    return result;
  } catch (error) {
    return { ok: false, error: { code: 'evaluation-failed', message: message(error) } };
  }
}

async function measureCache(cacheName: string): Promise<Result<CacheMeasurement>> {
  try {
    const cache = await openExistingCache(cacheName);
    const requests = await cache.keys();
    const visible = requests.slice(0, MAX_ENTRIES);
    let bodyBytes = 0;
    let unknownEntries = 0;
    let failedEntries = 0;
    for (const request of visible) {
      try {
        const response = await cache.match(request);
        if (!response || response.type === 'opaque') {
          unknownEntries += 1;
          continue;
        }
        bodyBytes += (await response.clone().blob()).size;
      } catch {
        failedEntries += 1;
      }
    }
    return {
      ok: true,
      value: {
        cacheName,
        entries: visible.length,
        bodyBytes,
        unknownEntries,
        failedEntries,
        complete: requests.length <= MAX_ENTRIES && unknownEntries === 0 && failedEntries === 0,
      },
    };
  } catch (error) {
    return { ok: false, error: { code: 'evaluation-failed', message: message(error) } };
  }
}

async function checkUrls(paths: string[]): Promise<Result<OfflineCheck[]>> {
  if (!('caches' in globalThis)) {
    return { ok: false, error: { code: 'evaluation-failed', message: 'Cache Storage is unavailable in this page context' } };
  }
  const checks: OfflineCheck[] = [];
  for (const input of paths.slice(0, 30)) {
    try {
      const url = new URL(input, location.origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== location.origin) {
        checks.push({ input, normalizedURL: null, found: false, status: null, contentType: null, error: { code: 'invalid-url', message: 'URL must be on the inspected origin' } });
        continue;
      }
      const response = await caches.match(url.href);
      checks.push({
        input,
        normalizedURL: url.href,
        found: Boolean(response),
        status: response?.type === 'opaque' ? null : response?.status ?? null,
        contentType: response?.headers.get('content-type') ?? null,
      });
    } catch (error) {
      checks.push({ input, normalizedURL: null, found: false, status: null, contentType: null, error: { code: 'invalid-url', message: message(error) } });
    }
  }
  return { ok: true, value: checks };
}

return async function executeDiagnostic(command: DiagnosticCommand): Promise<Result<unknown>> {
  if (command.type === 'overview') return overview();
  if (command.type === 'list-cache-keys') return listCacheKeys(command.cacheName);
  if (command.type === 'get-response-details') return details(command.cacheName, command.requestKey, command.preview === true);
  if (command.type === 'measure-cache') return measureCache(command.cacheName);
  return checkUrls(command.paths);
}
}

export const executeDiagnostic = createPageRunner();
