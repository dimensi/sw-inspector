import type { PageContext } from '../bridge/page-context';
import type { ActionHandlers, ActionItem, ActionRejection } from '../domain/actions';

// Serialized into the inspected document; keep all runtime dependencies inside.
export function createCacheActions(context: PageContext, snapshotRegistryKey: string): ActionHandlers {
  const reject = (code: ActionRejection['code'], message: string): never => { throw { kind: 'action-rejected', code, message }; };
  function invalidate(name: string) {
    const snapshots = (globalThis as Record<string, unknown>)[snapshotRegistryKey];
    if (snapshots instanceof Map) {
      for (const [id, snapshot] of snapshots) if (snapshot.cacheName === name) snapshots.delete(id);
    }
  }
  return {
    'delete-all-caches': {
      async prepare(intent) {
        if (intent.kind !== 'delete-all-caches') return reject('invalid-command', 'Invalid cache action');
        if (typeof caches === 'undefined' || typeof caches.keys !== 'function' || typeof caches.delete !== 'function') {
          return reject('unsupported', 'Cache Storage deletion is unavailable for this page');
        }
        const page = context.identity();
        const names = await caches.keys();
        if (!context.isCurrent(page)) return reject('stale-target', 'The inspected document changed; refresh before acting');
        if (names.length > 100) return reject('unsupported', 'More than 100 caches are present. Delete caches individually.');
        if (!names.length) return reject('cache-not-found', 'No caches are present. Refresh Cache Storage.');
        return { summary: [`Origin: ${page.origin}`, `Caches: ${names.length}`, ...names,
          'Cached responses in these listed caches will be removed. The site may recreate caches.'], retained: Object.freeze([...names]) };
      },
      async execute(retained, isCurrent) {
        if (!Array.isArray(retained) || retained.length < 1 || retained.length > 100 || !retained.every(name => typeof name === 'string')) {
          return reject('invalid-command', 'Invalid cache targets');
        }
        const items: ActionItem[] = [];
        for (const name of retained) {
          if (!isCurrent()) {
            items.push({ target: name, outcome: 'skipped', message: 'The inspected document changed; deletion was not attempted.' });
            continue;
          }
          try {
            const deleted = await caches.delete(name);
            invalidate(name);
            items.push({ target: name, outcome: deleted ? 'applied' : 'absent' });
          } catch (cause) {
            items.push({ target: name, outcome: 'failed', message: cause instanceof Error ? cause.message : String(cause) });
          }
        }
        return items;
      },
    },
    'delete-cache': {
      async prepare(intent) {
        if (intent.kind !== 'delete-cache') return reject('invalid-command', 'Invalid cache action');
        if (typeof caches === 'undefined' || typeof caches.keys !== 'function' || typeof caches.delete !== 'function') {
          return reject('unsupported', 'Cache Storage deletion is unavailable for this page');
        }
        const page = context.identity();
        const names = await caches.keys();
        if (!context.isCurrent(page)) return reject('stale-target', 'The inspected document changed; refresh before acting');
        if (!names.includes(intent.cacheName)) return reject('cache-not-found', 'This cache is no longer present; refresh Cache Storage');
        return { summary: [`Origin: ${page.origin}`, `Cache: ${intent.cacheName}`, 'Cached responses will be removed. The site may recreate this cache.'], retained: intent.cacheName };
      },
      async execute(retained, isCurrent) {
        if (typeof retained !== 'string') return reject('invalid-command', 'Invalid cache target');
        if (!isCurrent()) return reject('stale-target', 'The inspected document changed; refresh before acting');
        try {
          const deleted = await caches.delete(retained);
          invalidate(retained);
          return [{ target: retained, outcome: deleted ? 'applied' : 'absent' }];
        } catch (cause) {
          return [{ target: retained, outcome: 'failed', message: cause instanceof Error ? cause.message : String(cause) }];
        }
      },
    },
  };
}
