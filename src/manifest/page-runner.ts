import type { PageContext } from '../bridge/page-context';
import type { PageIdentity, Result } from '../domain/types';
import type { ManifestCommand, ManifestDiscovery, ManifestFetch, ManifestLink } from './types';

// Serialized into the inspected document; keep runtime dependencies inside this factory.
export function createManifestRunner(context: PageContext): (command: ManifestCommand) => Promise<Result<ManifestDiscovery | ManifestFetch>> {
  type RetainedManifestSnapshot = { page: PageIdentity; element: HTMLLinkElement; link: ManifestLink; expiresAt: number };
  type ManifestRuntime = { snapshots: Map<string, RetainedManifestSnapshot>; controllers: Set<AbortController> };
  const runtimeKey = 'manifest:runtime:v1';
  function runtime(): ManifestRuntime {
    let current = context.manifests.get(runtimeKey) as ManifestRuntime | undefined;
    if (!current) {
      current = { snapshots: new Map(), controllers: new Set() };
      context.manifests.set(runtimeKey, current);
      const retained = current;
      context.onDispose(() => {
        for (const controller of retained.controllers) controller.abort();
        retained.controllers.clear();
        retained.snapshots.clear();
      });
    }
    for (const [id, snapshot] of current.snapshots) {
      if (snapshot.expiresAt <= Date.now()) current.snapshots.delete(id);
    }
    return current;
  }
  function describe(element: HTMLLinkElement): ManifestLink {
    const href = element.getAttribute('href');
    const link: ManifestLink = { href, url: null, crossOrigin: element.crossOrigin, referrerPolicy: element.referrerPolicy, issue: null };
    if (href === null) link.issue = 'missing-href';
    else if (!href.trim()) link.issue = 'empty-href';
    else {
      try {
        const url = new URL(element.href);
        link.url = url.href;
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) link.issue = 'unsupported-url';
      } catch { link.issue = 'invalid-url'; }
    }
    return link;
  }
  return async command => {
    if (!context.isCurrent(command.expectedPage)) {
      return { ok: false, error: { code: 'stale-result', message: 'The inspected page changed. Discover the manifest again.' } };
    }
    const state = runtime();
    if (command.type === 'manifest:discover') {
      const page = { ...context.identity() };
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel~="manifest" i]');
      const element = links[0];
      if (!element) return { ok: true, value: { page, snapshotId: null, linkCount: links.length, link: null } };
      const link = describe(element);
      const snapshotId = crypto.randomUUID();
      while (state.snapshots.size >= 8) state.snapshots.delete(state.snapshots.keys().next().value!);
      state.snapshots.set(snapshotId, { page, element, link: { ...link }, expiresAt: Date.now() + 60000 });
      return { ok: true, value: { page, snapshotId, linkCount: links.length, link } };
    }
    if (command.type === 'manifest:fetch') {
      const snapshot = state.snapshots.get(command.snapshotId);
      if (!snapshot) return { ok: false, error: { code: 'stale-snapshot', message: 'Manifest discovery expired. Discover the manifest again.' } };
      if (!context.isCurrent(snapshot.page)) return { ok: false, error: { code: 'stale-result', message: 'The inspected page changed. Discover the manifest again.' } };
      return { ok: false, error: { code: 'unsupported', message: snapshot.link.issue
        ? 'Fix the manifest link and discover it again.' : 'Manifest loading is not enabled.' } };
    }
    return { ok: false, error: { code: 'invalid-command', message: 'Unknown manifest command.' } };
  };
}
