<script lang="ts">
  import type { InspectorCommand } from '../../src/domain/commands';
  import type { PageIdentity, Result } from '../../src/domain/types';
  import type { ManifestAnalysis, ManifestDiscovery, ManifestFetch } from '../../src/manifest/types';
  import { parseManifest } from '../../src/manifest/parse';
  import { formatBytes } from '../../src/domain/format';

  let { page, refreshToken, invoke }: {
    page: PageIdentity | null;
    refreshToken: number;
    invoke: <T>(command: InspectorCommand, options?: { signal?: AbortSignal }) => Promise<Result<T>>;
  } = $props();
  let discovery = $state<ManifestDiscovery | null>(null);
  let source = $state<string | null>(null);
  let analysis = $state<ManifestAnalysis | null>(null);
  let response = $state<ManifestFetch | null>(null);
  let localError = $state<string | null>(null);
  let busy = $state<'discover' | 'load' | null>(null);
  let showSource = $state(false);
  let generation = 0;
  let controller: AbortController | null = null;
  const canLoad = $derived(!!page && !!discovery?.snapshotId && !!discovery.link?.url
    && discovery.link.issue === null && samePage(discovery.page, page));
  function samePage(a: PageIdentity, b: PageIdentity) {
    return a.documentId === b.documentId && a.origin === b.origin && a.url === b.url;
  }
  function invalidate() { generation += 1; controller?.abort(); controller = null; }
  $effect(() => {
    page;
    refreshToken;
    invalidate();
    discovery = null; source = null; analysis = null; response = null;
    localError = null; busy = null; showSource = false;
    return invalidate;
  });
  function begin(kind: 'discover' | 'load') {
    if (!page) return null;
    invalidate();
    controller = new AbortController();
    busy = kind; localError = null; source = null; analysis = null; response = null; showSource = false;
    return { operation: generation, page: { ...page }, refresh: refreshToken, controller };
  }
  function current(job: NonNullable<ReturnType<typeof begin>>) {
    return job.operation === generation && !job.controller.signal.aborted
      && !!page && samePage(page, job.page) && refreshToken === job.refresh;
  }
  async function discover() {
    const job = begin('discover');
    if (!job) return;
    discovery = null;
    try {
      const result = await invoke<ManifestDiscovery>({ type: 'manifest:discover', expectedPage: job.page }, { signal: job.controller.signal });
      if (!current(job)) return;
      if (result.ok && samePage(result.value.page, job.page)) discovery = result.value;
      else localError = result.ok ? 'The inspected page changed. Discover the manifest again.' : result.error.message;
    } catch (error) { if (current(job)) localError = error instanceof Error ? error.message : String(error); }
    finally { if (current(job)) busy = null; }
  }
  async function load() {
    if (!canLoad || !discovery?.snapshotId) return;
    const snapshotId = discovery.snapshotId;
    const job = begin('load');
    if (!job) return;
    try {
      const result = await invoke<ManifestFetch>({ type: 'manifest:fetch', expectedPage: job.page, snapshotId }, { signal: job.controller.signal });
      if (!current(job)) return;
      if (!result.ok) { localError = result.error.message; return; }
      if (!samePage(result.value.page, job.page)) { localError = 'The inspected page changed. Discover the manifest again.'; return; }
      response = result.value;
      if (result.value.state === 'failed') { localError = result.value.message; return; }
      source = result.value.text;
      analysis = parseManifest({ documentURL: result.value.page.url, manifestURL: result.value.finalURL, contentType: result.value.contentType, text: result.value.text });
    } catch (error) { if (current(job)) localError = error instanceof Error ? error.message : String(error); }
    finally { if (current(job)) busy = null; }
  }
  function valueText(value: unknown) { return value === undefined ? 'Not declared' : JSON.stringify(value); }
  const linkIssues = { 'missing-href': 'The first manifest link has no href.', 'empty-href': 'The first manifest link has an empty href.', 'invalid-url': 'The first manifest link URL cannot be resolved.', 'unsupported-url': 'This manifest link uses an unsupported scheme or URL credentials.' };
</script>

<section class="manifest-pane" aria-label="Web App Manifest" aria-busy={!!busy}>
  <div class="pane-toolbar">
    <h1>Manifest</h1><span class="toolbar-space"></span>
    <button onclick={discover} disabled={!page || busy === 'discover'}>{busy === 'discover' ? 'Discovering…' : 'Discover manifest'}</button>
    <button onclick={load} disabled={!canLoad || !!busy}>{busy === 'load' ? 'Loading…' : 'Load manifest'}</button>
    <button onclick={() => { showSource = !showSource; }} disabled={source === null || !!busy} aria-expanded={showSource}>{showSource ? 'Hide source' : 'Show source'}</button>
  </div>
  {#if localError}<p class="notice error" role="alert">{localError}</p>{/if}
  {#if busy}<p class="notice" role="status">{busy === 'discover' ? 'Reading the declared manifest link…' : 'Loading the manifest response…'}</p>{/if}
  <div class="content-scroll">
    {#if !page}<p class="empty-state">Refresh to inspect this page.</p>
    {:else if !discovery}<div class="empty-state"><strong>No manifest discovery</strong><p>Discover the manifest link declared by this document. Loading requires an explicit request.</p></div>
    {:else if !discovery.link}<p class="empty-state">No manifest link declared by this document.</p>
    {:else}
      <h2 class="section-title">Document link</h2>
      <dl class="properties">
        <div><dt>Declared href</dt><dd><code>{discovery.link.href === null ? 'Missing' : discovery.link.href || 'Empty'}</code></dd></div>
        <div><dt>Resolved source URL</dt><dd><code>{discovery.link.url ?? 'Unavailable'}</code></dd></div>
        <div><dt>Manifest links</dt><dd>{discovery.linkCount} · first link selected</dd></div>
        <div><dt>Cross-origin mode</dt><dd>{discovery.link.crossOrigin ?? 'Default'}</dd></div>
        <div><dt>Referrer policy</dt><dd>{discovery.link.referrerPolicy || 'Default'}</dd></div>
      </dl>
      {#if discovery.link.issue}<p class="notice warning">{linkIssues[discovery.link.issue]} Fix the link and discover again.</p>{/if}
      {#if response}
        <h2 class="section-title">Response</h2>
        <dl class="properties">
          <div><dt>Requested URL</dt><dd><code>{response.requestedURL}</code></dd></div>
          <div><dt>Final URL</dt><dd><code>{response.finalURL ?? 'Unknown'}</code></dd></div>
          <div><dt>Status</dt><dd>{response.status ?? 'Unknown'}</dd></div>
          <div><dt>MIME type</dt><dd><code>{response.contentType ?? 'Not supplied'}</code></dd></div>
          <div><dt>Response bytes read</dt><dd>{formatBytes(response.readBytes)}</dd></div>
        </dl>
      {/if}
      {#if analysis}
        <p class="notice">Loaded by SW Inspector. Safari may process this manifest differently.</p>
        {#if analysis.fields.length}<h2 class="section-title">Manifest fields</h2><dl class="properties">
          {#each analysis.fields as field (field.key)}<div><dt>{field.key}</dt><dd><span class="value-label">Declared</span><code>{valueText(field.declared)}</code>{#if field.resolved !== null}<span class="value-label">Resolved by SW Inspector{field.source === 'fallback' ? ' · fallback' : ''}</span><code>{field.resolved}</code>{/if}</dd></div>{/each}
        </dl>{/if}
        {#if analysis.diagnostics.length}<h2 class="section-title">Diagnostics</h2>{#each analysis.diagnostics as diagnostic, index (index)}<p class="notice" class:error={diagnostic.severity === 'error'} class:warning={diagnostic.severity === 'warning'}><span><code>{diagnostic.path}</code>{diagnostic.path ? ': ' : ''}{diagnostic.message}</span></p>{/each}{/if}
        {#if analysis.icons.length}<h2 class="section-title">Declared icons · no image requests</h2><div class="table-scroll"><table><thead><tr><th scope="col">#</th><th scope="col">Declared src</th><th scope="col">Resolved URL</th><th scope="col">Sizes</th><th scope="col">Type</th><th scope="col">Purpose</th></tr></thead><tbody>{#each analysis.icons as icon (icon.index)}<tr><td>{icon.index}</td><td><code>{icon.src ?? 'Unavailable'}</code></td><td><code>{icon.resolvedURL ?? 'Unavailable'}</code></td><td>{icon.sizes ?? 'Not declared'}</td><td>{icon.type ?? 'Not declared'}</td><td>{icon.purpose ?? 'Not declared'}</td></tr>{/each}</tbody></table></div>{/if}
      {/if}
      {#if showSource && source !== null}
        <h2 class="section-title">Manifest source</h2>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (The named scroll region needs keyboard scrolling in Safari.) -->
        <div class="source" role="region" tabindex="0" aria-label="Manifest source"><pre>{source}</pre></div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .manifest-pane { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
  h1, h2, p, dl { margin: 0; }
  h1, h2 { font-size: 12px; font-weight: 600; }
  code, pre { font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  code { overflow-wrap: anywhere; }
  .pane-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; flex: none; min-height: 33px; padding: 4px 10px; border-bottom: 1px solid var(--border); background: var(--chrome); }
  .toolbar-space { flex: 1; }
  button { min-height: 24px; padding: 2px 8px; font: inherit; color: inherit; border: 1px solid var(--border); border-radius: 3px; background: var(--button); white-space: nowrap; }
  button:hover:not(:disabled) { background: var(--hover); }
  button:active:not(:disabled) { background: var(--border); }
  button:disabled { opacity: .45; }
  button:focus-visible, .source:focus-visible { outline: 2px solid var(--selection); outline-offset: -2px; }
  .content-scroll { flex: 1; min-height: 0; overflow: auto; }
  .section-title { margin-top: 16px; padding: 5px 12px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--subtle-border); background: var(--stripe); }
  .content-scroll > .section-title:first-child { margin-top: 0; border-top: 0; }
  .properties { padding: 8px 12px; }
  .properties > div { display: grid; grid-template-columns: 138px minmax(0, 1fr); gap: 12px; min-height: 25px; align-items: baseline; padding: 3px 0; }
  dt, .value-label { color: var(--secondary); }
  dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  dd code, .value-label { display: block; }
  .value-label { font-size: 11px; }
  .value-label:not(:first-child) { margin-top: 4px; }
  .notice { flex: none; padding: 7px 10px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; font-size: 11px; }
  .notice.error { color: var(--error); background: var(--error-bg); }
  .notice.warning { color: var(--warning); background: var(--warning-bg); }
  .empty-state { padding: 22px 18px; }
  .empty-state p { margin-top: 4px; color: var(--secondary); }
  .table-scroll { overflow: auto; }
  table { width: 100%; min-width: 620px; table-layout: fixed; border-spacing: 0; font-size: 11px; }
  th { position: sticky; top: 0; padding: 3px 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--chrome); text-align: left; font-weight: 400; }
  th:first-child { width: 36px; }
  td { padding: 3px 8px; vertical-align: top; overflow-wrap: anywhere; }
  tr:nth-child(even) { background: var(--stripe); }
  .source pre { margin: 0; }
  .source { max-height: 40dvh; overflow: auto; margin: 0; padding: 10px 12px; white-space: pre; }
  @media (max-width: 600px) { .properties > div { grid-template-columns: 108px minmax(0, 1fr); gap: 8px; } }
</style>
