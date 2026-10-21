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
  async function load(snapshotId: string, expectedPage: PageIdentity, state: ManifestRuntime): Promise<Result<ManifestFetch>> {
    type Failure = Extract<Result<ManifestFetch>, { ok: false }>;
    const snapshot = state.snapshots.get(snapshotId);
    const expired = (): Failure => ({ ok: false, error: { code: 'stale-snapshot', message: 'Manifest discovery expired. Discover the manifest again.' } });
    const stale = (): Failure => ({ ok: false, error: { code: 'stale-result', message: 'The inspected page or manifest link changed. Discover the manifest again.' } });
    if (!snapshot) return expired();
    function currentError(): Failure | null {
      if (!context.isCurrent(expectedPage) || !context.isCurrent(snapshot!.page)) return stale();
      if (snapshot!.expiresAt <= Date.now() || state.snapshots.get(snapshotId) !== snapshot) return expired();
      const element = document.querySelectorAll<HTMLLinkElement>('link[rel~="manifest" i]')[0];
      if (element !== snapshot!.element) return stale();
      const link = describe(element);
      if (link.href !== snapshot!.link.href || link.url !== snapshot!.link.url
        || link.crossOrigin !== snapshot!.link.crossOrigin || link.referrerPolicy !== snapshot!.link.referrerPolicy) return stale();
      return null;
    }
    const initialError = currentError();
    if (initialError) return initialError;
    if (snapshot.link.issue || !snapshot.link.url) return { ok: false, error: { code: 'unsupported', message: 'Fix the manifest link and discover it again.' } };
    const metadata: Pick<ManifestFetch, 'page' | 'snapshotId' | 'requestedURL' | 'finalURL' | 'status' | 'contentType' | 'redirected' | 'readBytes'> = {
      page: { ...snapshot.page }, snapshotId, requestedURL: snapshot.link.url,
      finalURL: null, status: null, contentType: null, redirected: null, readBytes: null,
    };
    function failed(reason: Extract<ManifestFetch, { state: 'failed' }>['reason'], message: string): Result<ManifestFetch> {
      return { ok: true, value: { ...metadata, state: 'failed', reason, message } };
    }
    const controller = new AbortController();
    const deadline = Date.now() + 8000;
    const timeout = {};
    let rejected: Failure | null = null;
    let timedOut = false;
    let finished = false;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    function guard() {
      rejected = currentError();
      if (rejected) throw rejected;
      if (timedOut || Date.now() >= deadline) {
        timedOut = true;
        controller.abort();
        throw timeout;
      }
    }
    // One listener per currently awaited operation; remove it on every settlement.
    function bounded<T>(promise: Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        const abort = () => { cleanup(); reject(timeout); };
        const cleanup = () => controller.signal.removeEventListener('abort', abort);
        controller.signal.addEventListener('abort', abort, { once: true });
        promise.then(value => {
          cleanup();
          try { guard(); resolve(value); } catch (error) { reject(error); }
        }, error => { cleanup(); reject(error); });
        if (controller.signal.aborted) abort();
      });
    }
    function cancelBody(body: ReadableStream<Uint8Array> | null) {
      try { void body?.cancel().catch(() => {}); } catch { /* Cleanup must not delay the result. */ }
    }
    state.controllers.add(controller);
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
      guard();
      const received = await bounded<Response>(fetch(snapshot.link.url, {
        mode: 'cors', credentials: snapshot.link.crossOrigin?.toLowerCase() === 'use-credentials' ? 'include' : 'same-origin',
        redirect: 'follow', cache: 'default', referrerPolicy: snapshot.link.referrerPolicy as ReferrerPolicy, signal: controller.signal,
      }).then(value => {
        response = value;
        if (finished) cancelBody(value.body);
        return value;
      }));
      response = received;
      metadata.status = received.status || null;
      metadata.contentType = received.headers.get('content-type');
      metadata.redirected = received.redirected;
      try {
        const final = new URL(received.url);
        if (['http:', 'https:'].includes(final.protocol) && !final.username && !final.password) metadata.finalURL = final.href;
      } catch { /* No final URL may be guessed from the request URL. */ }
      if (received.type === 'opaque' || received.type === 'opaqueredirect' || !received.status) return failed('unreadable', 'The manifest response is not readable.');
      if (received.status < 200 || received.status >= 300) return failed('http-error', `Manifest request returned HTTP ${received.status}.`);
      if (!metadata.finalURL || !received.body) return failed('unreadable', 'The manifest response has no readable body or valid final URL.');
      reader = received.body.getReader();
      const chunks: Uint8Array[] = [];
      metadata.readBytes = 0;
      while (true) {
        guard();
        const next = await bounded(reader.read());
        if (next.done) break;
        metadata.readBytes += next.value.byteLength;
        if (metadata.readBytes > 262144) return failed('too-large', 'The manifest exceeds the 256 KiB response limit.');
        if (next.value.byteLength) chunks.push(next.value);
      }
      const bytes = new Uint8Array(metadata.readBytes);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { ok: true, value: { ...metadata, state: 'loaded', finalURL: metadata.finalURL, text: new TextDecoder().decode(bytes) } };
    } catch (error) {
      const current = rejected ?? currentError();
      if (current) return current;
      if (timedOut || error === timeout && Date.now() >= deadline) return failed('timeout', 'Manifest loading timed out after 8 seconds.');
      return failed('network-error', error instanceof Error ? error.message : String(error));
    } finally {
      finished = true;
      clearTimeout(timer);
      state.controllers.delete(controller);
      if (reader) {
        try { void reader.cancel().catch(() => {}); } catch { /* Do not wait for cancellation. */ }
      } else if (response) cancelBody(response.body);
    }
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
      return load(command.snapshotId, command.expectedPage, state);
    }
    return { ok: false, error: { code: 'invalid-command', message: 'Unknown manifest command.' } };
  };
}
