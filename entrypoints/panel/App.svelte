<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { browser } from 'wxt/browser';
  import { evaluateInspectedWindow, subscribeInspectedNavigation } from '../../src/bridge/eval-window';
  import { describeDevToolsBinding, type DevToolsNamespace } from '../../src/bridge/runtime-binding';
  import { createTransport } from '../../src/bridge/transport';
  import { formatBytes, formatStoragePercentage } from '../../src/domain/format';
  import { deriveInspectionStatus } from '../../src/domain/inspection-status';
  import type { CacheDetails, CacheInventory, CacheMeasurement, OfflineCheck, Overview } from '../../src/domain/types';
  import { buildReport } from '../../src/export/report';

  const transport = createTransport(evaluateInspectedWindow, {
    async getOrigin() {
      const [value, exception] = await evaluateInspectedWindow('location.origin');
      return exception || typeof value !== 'string' ? 'unknown-origin' : value;
    },
  });
  type View = 'workers' | 'caches' | 'cache' | 'offline' | 'diagnostics';
  let view = $state<View>('workers');
  let cachesOpen = $state(true);
  let requestedCache = $state('');
  let lastUpdated = $state<string | null>(null);
  let overview = $state<Overview | null>(null);
  let selectedInventory = $state<CacheInventory | null>(null);
  let selectedDetails = $state<CacheDetails | null>(null);
  let selectedRequestKey = $state<string | null>(null);
  let measurements = $state<CacheMeasurement[]>([]);
  let offlineChecks = $state<OfflineCheck[]>([]);
  let offlinePaths = $state('/\n/calls\n/chats');
  let cacheQuery = $state('');
  let loading = $state(false);
  let working = $state('');
  type OperationArea = 'cache' | 'details' | 'measure' | 'offline';
  let inspectionError = $state<string | null>(null);
  let operationError = $state<{ area: OperationArea; message: string } | null>(null);
  let probeResults = $state<Array<{ label: string; outcome: string }>>([]);
  let navigationGeneration = 0;
  let refreshGeneration = 0;
  let cacheSelectionGeneration = 0;
  let detailsGeneration = 0;
  let measurementController: AbortController | null = null;
  const probeJobKey = `__swInspectorProbe_${crypto.randomUUID()}`;
  const devToolsBinding = describeDevToolsBinding(browser, {
    browser: (globalThis as { browser?: DevToolsNamespace }).browser,
    chrome: (globalThis as { chrome?: DevToolsNamespace }).chrome,
  });
  let inspectionStatus = $derived(deriveInspectionStatus(overview, loading, inspectionError));
  let selectedMeasurement = $derived(selectedInventory ? measurements.find((item) => item.cacheName === selectedInventory?.cacheName) ?? null : null);

  let visibleEntries = $derived(selectedInventory?.entries.filter((entry) => entry.url.toLowerCase().includes(cacheQuery.toLowerCase())) ?? []);
  let selectedEntry = $derived(selectedInventory?.entries.find((entry) => entry.requestKey === selectedRequestKey));

  function requestPath(url: string) {
    try {
      const parsed = new URL(url);
      return parsed.origin === overview?.origin ? `${parsed.pathname}${parsed.search}` : url;
    } catch { return url; }
  }

  function navigateRequests(event: KeyboardEvent, index: number) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? visibleEntries.length - 1
      : Math.min(visibleEntries.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const buttons = (event.currentTarget as HTMLButtonElement).closest('tbody')?.querySelectorAll<HTMLButtonElement>('.request-button');
    buttons?.[next]?.focus();
    if (visibleEntries[next]) void showDetails(visibleEntries[next].requestKey);
  }

  async function runProbeExpression(label: string, source: string) {
    const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out after 3 seconds')), 3_000));
    try {
      const [value, exception] = await Promise.race([evaluateInspectedWindow(source), deadline]);
      probeResults = [...probeResults, { label, outcome: exception ? `error: ${exception.value ?? exception.code ?? 'unknown Safari error'}` : `returned: ${String(value)}` }];
    } catch (reason) {
      probeResults = [...probeResults, { label, outcome: `error: ${reason instanceof Error ? reason.message : String(reason)}` }];
    }
  }

  async function runDevToolsProbe() {
    probeResults = [];
    await runProbeExpression('Synchronous JSON', "JSON.stringify({ probe: 'sync', origin: location.origin })");
    probeResults = [...probeResults, { label: 'Returned Promise', outcome: 'not evaluated: Chrome returned a Promise object instead of its value' }];
    const key = JSON.stringify(probeJobKey);
    await runProbeExpression('Deferred job start', `(function () { const job = { state: 'pending' }; globalThis[${key}] = job; Promise.resolve().then(() => ({ probe: 'deferred', origin: location.origin })).then((result) => { job.state = 'complete'; job.result = result; }); setTimeout(() => delete globalThis[${key}], 10000); return JSON.stringify({ probe: 'deferred-started' }); })()`);
    await new Promise((resolve) => setTimeout(resolve, 75));
    await runProbeExpression('Deferred job poll', `(function () { const job = globalThis[${key}]; return JSON.stringify(job ?? { state: 'missing' }); })()`);
  }

  async function refresh() {
    const navigation = navigationGeneration;
    const operation = ++refreshGeneration;
    loading = true;
    inspectionError = null;
    operationError = null;
    selectedInventory = null;
    selectedDetails = null;
    selectedRequestKey = null;
    if (view === 'cache') view = 'caches';
    const result = await transport.invoke<Overview>({ type: 'overview' });
    if (navigation !== navigationGeneration || operation !== refreshGeneration) return;
    loading = false;
    if (result.ok) { overview = result.value; lastUpdated = new Date().toLocaleTimeString(); }
    else inspectionError = result.error.message;
  }

  async function chooseCache(name: string) {
    view = 'cache';
    requestedCache = name;
    selectedInventory = null;
    cacheQuery = '';
    const navigation = navigationGeneration;
    const operation = ++cacheSelectionGeneration;
    working = `cache:${name}`;
    operationError = null;
    selectedDetails = null;
    selectedRequestKey = null;
    const result = await transport.invoke<CacheInventory>({ type: 'list-cache-keys', cacheName: name });
    if (navigation !== navigationGeneration || operation !== cacheSelectionGeneration) return;
    working = '';
    if (result.ok) selectedInventory = result.value;
    else operationError = { area: 'cache', message: result.error.message };
  }

  async function showDetails(requestKey: string, preview = false) {
    if (!selectedInventory) return;
    const navigation = navigationGeneration;
    const inventory = selectedInventory;
    const operation = ++detailsGeneration;
    working = `entry:${requestKey}`;
    selectedRequestKey = requestKey;
    if (!preview) selectedDetails = null;
    operationError = null;
    const result = await transport.invoke<CacheDetails>({
      type: 'get-response-details', cacheName: inventory.cacheName, requestKey, preview,
    });
    if (navigation !== navigationGeneration || operation !== detailsGeneration || selectedInventory?.snapshotId !== inventory.snapshotId) return;
    working = '';
    if (result.ok) {
      selectedDetails = result.value;
      selectedRequestKey = requestKey;
    }
    else operationError = { area: 'details', message: result.error.message };
  }

  async function measure() {
    if (!selectedInventory) return;
    measurementController?.abort();
    const controller = new AbortController();
    measurementController = controller;
    const navigation = navigationGeneration;
    const cacheName = selectedInventory.cacheName;
    working = `measure:${selectedInventory.cacheName}`;
    operationError = null;
    const result = await transport.invoke<CacheMeasurement>({ type: 'measure-cache', cacheName }, { signal: controller.signal });
    if (measurementController !== controller || navigation !== navigationGeneration) return;
    measurementController = null;
    working = '';
    if (result.ok) measurements = [...measurements.filter((item) => item.cacheName !== result.value.cacheName), result.value];
    else operationError = { area: 'measure', message: result.error.message };
  }

  function stopMeasurement() {
    measurementController?.abort();
  }

  async function checkOffline() {
    working = 'offline';
    operationError = null;
    const paths = offlinePaths.split('\n').map((path) => path.trim()).filter(Boolean).slice(0, 30);
    const result = await transport.invoke<OfflineCheck[]>({ type: 'check-urls', paths });
    working = '';
    if (result.ok) offlineChecks = result.value;
    else operationError = { area: 'offline', message: result.error.message };
  }

  function downloadReport() {
    if (!overview) return;
    const text = buildReport({
      timestamp: new Date().toISOString(), userAgent: navigator.userAgent, overview,
      inventories: selectedInventory ? [selectedInventory] : [], measurements, checks: offlineChecks,
      details: selectedDetails ? [selectedDetails] : [],
    });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sw-inspector-report.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  onMount(() => {
    const onNavigated = () => {
      navigationGeneration += 1;
      transport.invalidate();
      measurementController?.abort();
      measurementController = null;
      overview = null;
      lastUpdated = null;
      inspectionError = null;
      operationError = null;
      selectedInventory = null;
      selectedDetails = null;
      measurements = [];
      offlineChecks = [];
      void refresh();
    };
    return subscribeInspectedNavigation(onNavigated);
  });
</script>

<main class="inspector">
  <header class="toolbar">
    <button class="tool-button" onclick={refresh} disabled={loading} title="Read a fresh snapshot of the inspected page"><Icon name="refresh" /><span>{loading ? 'Refreshing…' : 'Refresh'}</span></button>
    <button class="tool-button" onclick={downloadReport} disabled={!overview} title="Export diagnostic metadata as JSON"><Icon name="export" /><span>Export</span></button>
    <span class="toolbar-divider"></span>
    <span class="origin" title={overview?.origin ?? 'Origin is available after inspection'}>{overview?.origin ?? 'No inspected origin'}</span>
    <span class="read-only">Read only</span>
  </header>

  <div class="compact-navigation">
    <label for="section-select">View</label>
    <select id="section-select" value={view === 'cache' ? 'caches' : view} onchange={(event) => { view = event.currentTarget.value as View; }}>
      <option value="workers">Service Workers</option><option value="caches">Cache Storage</option><option value="offline">Offline Resources</option><option value="diagnostics">Diagnostics</option>
    </select>
    {#if view === 'cache' || view === 'caches'}
      <select aria-label="Cache namespace" value={view === 'cache' ? requestedCache : ''} onchange={(event) => { const name = event.currentTarget.value; if (name) void chooseCache(name); else view = 'caches'; }}>
        <option value="">All caches</option>{#each overview?.caches ?? [] as cache (cache.name)}<option value={cache.name}>{cache.name}</option>{/each}
      </select>
    {/if}
  </div>

  <div class="workspace">
    <nav class="sidebar" aria-label="Inspection views">
      <div class="navigation-items">
        <button class="navigation-row" class:current={view === 'workers'} aria-current={view === 'workers' ? 'page' : undefined} onclick={() => { view = 'workers'; }}><Icon name="worker" /><span>Service Workers</span><span class="count">{overview?.registrations.length ?? '—'}</span></button>
        <div class="cache-navigation">
          <button class="disclosure" aria-label={cachesOpen ? 'Collapse cache namespaces' : 'Expand cache namespaces'} aria-expanded={cachesOpen} onclick={() => { cachesOpen = !cachesOpen; }}><span class:expanded={cachesOpen}><Icon name="chevron" size={10} /></span></button>
          <button class="navigation-row cache-heading" class:current={view === 'caches'} aria-current={view === 'caches' ? 'page' : undefined} onclick={() => { view = 'caches'; cachesOpen = true; }}><Icon name="database" /><span>Cache Storage</span><span class="count">{overview?.caches.length ?? '—'}</span></button>
        </div>
        {#if cachesOpen}
          {#each overview?.caches ?? [] as cache (cache.name)}
            <button class="navigation-row cache-child" class:current={view === 'cache' && requestedCache === cache.name} aria-current={view === 'cache' && requestedCache === cache.name ? 'page' : undefined} title={cache.name} onclick={() => chooseCache(cache.name)} disabled={working === `cache:${cache.name}`}><Icon name="database" size={12} /><span>{cache.name}</span><span class="count">{cache.entries}{cache.partial ? '+' : ''}</span></button>
          {:else}<span class="tree-empty">{overview ? 'No caches' : 'Not inspected'}</span>{/each}
        {/if}
        <button class="navigation-row" class:current={view === 'offline'} aria-current={view === 'offline' ? 'page' : undefined} onclick={() => { view = 'offline'; }}><Icon name="check" /><span>Offline Resources</span></button>
      </div>
      <button class="navigation-row diagnostic-navigation" class:current={view === 'diagnostics'} aria-current={view === 'diagnostics' ? 'page' : undefined} onclick={() => { view = 'diagnostics'; }}><Icon name="diagnostics" /><span>Diagnostics</span></button>
    </nav>

    <section class="content" aria-label="Inspection content" aria-busy={loading}>
      {#if inspectionError}
        <div class="notice error" role="alert"><Icon name="warning" /><div><strong>Inspection failed</strong><p>{inspectionError}</p>{#if inspectionError.includes('does not have access')}<p>Click SW Inspector in Safari’s toolbar to allow this tab, then refresh.</p>{/if}</div></div>
      {/if}

      {#if view === 'workers'}
        <div class="pane-toolbar"><h1>Service Workers</h1><span class="secondary">{overview ? `${overview.registrations.length} registered` : 'Not inspected'}</span></div>
        <div class="content-scroll">
          {#if !overview}
            <div class="empty-state"><strong>{loading ? 'Reading Service Workers…' : 'No snapshot'}</strong><p>Refresh to read registrations and storage for this page.</p></div>
          {:else}
            <h2 class="section-title">Page</h2>
            <dl class="properties">
              <div><dt>Origin</dt><dd><code>{overview.origin}</code></dd></div>
              <div><dt>Controller</dt><dd>{#if overview.controller}<code>{overview.controller.scriptURL}</code>{:else}None{/if}</dd></div>
              <div><dt>State</dt><dd class:success={!!overview.controller}>{overview.controller?.state ?? 'Not controlled'}</dd></div>
            </dl>
            {#each overview.registrations as registration (registration.scope)}
              <h2 class="section-title"><Icon name="worker" />Registration</h2>
              <dl class="properties">
                <div><dt>Scope</dt><dd><code>{registration.scope}</code></dd></div>
                <div><dt>Active</dt><dd>{#if registration.active}<span class="success">{registration.active.state}</span><code class="property-script">{registration.active.scriptURL}</code>{:else}None{/if}</dd></div>
                <div><dt>Waiting</dt><dd>{#if registration.waiting}<span>{registration.waiting.state}</span><code class="property-script">{registration.waiting.scriptURL}</code>{:else}<span class="secondary">None</span>{/if}</dd></div>
                <div><dt>Installing</dt><dd>{#if registration.installing}<span>{registration.installing.state}</span><code class="property-script">{registration.installing.scriptURL}</code>{:else}<span class="secondary">None</span>{/if}</dd></div>
              </dl>
            {:else}<p class="inline-empty">No Service Worker registrations for this origin.</p>{/each}
            <h2 class="section-title">Origin storage</h2>
            <dl class="properties">
              <div><dt>Estimated usage</dt><dd class="numeric">{formatBytes(overview.storage.usageBytes)}</dd></div>
              <div><dt>Estimated quota</dt><dd class="numeric">{formatBytes(overview.storage.quotaBytes)} <span class="secondary">({formatStoragePercentage(overview.storage.usageBytes, overview.storage.quotaBytes)} used)</span></dd></div>
              <div><dt>Cache namespaces</dt><dd>{overview.caches.length}</dd></div>
            </dl>
            <p class="footnote">Storage estimates cover the whole origin, including data outside Cache Storage.</p>
            {#each overview.warnings as warning, index (index)}<div class="notice warning"><Icon name="warning" /><span>{warning}</span></div>{/each}
          {/if}
        </div>

      {:else if view === 'caches'}
        <div class="pane-toolbar"><h1>Cache Storage</h1><span class="secondary">{overview?.caches.length ?? '—'} namespaces</span></div>
        {#if operationError?.area === 'cache'}<p class="notice error" role="alert">{operationError.message}</p>{/if}
        <div class="table-scroll">
          <table class="data-table cache-table"><thead><tr><th scope="col">Name</th><th scope="col" class="number-cell">Keys</th><th scope="col">Inventory</th></tr></thead><tbody>
            {#each overview?.caches ?? [] as cache (cache.name)}<tr><td><button class="cell-button" onclick={() => chooseCache(cache.name)}><Icon name="database" /><span>{cache.name}</span></button></td><td class="number-cell">{cache.entries}</td><td class="secondary">{cache.partial ? 'Partial' : 'Complete'}</td></tr>
            {:else}<tr><td colspan="3" class="table-empty">{overview ? 'No caches for this origin.' : 'Refresh to list cache namespaces.'}</td></tr>{/each}
          </tbody></table>
        </div>

      {:else if view === 'cache'}
        <div class="pane-toolbar cache-toolbar"><h1 title={requestedCache}>{requestedCache}</h1><span class="secondary">{selectedInventory ? `${selectedInventory.totalEntries} keys` : 'Loading…'}</span><span class="toolbar-space"></span><button onclick={measure} disabled={!selectedInventory || working.startsWith('measure:')}>{working.startsWith('measure:') ? 'Measuring…' : 'Measure bodies'}</button>{#if working.startsWith('measure:')}<button onclick={stopMeasurement}>Stop updates</button>{/if}</div>
        {#if operationError?.area === 'cache' || operationError?.area === 'measure'}<p class="notice error" role="alert">{operationError.message}</p>{/if}
        {#if selectedInventory?.partial}<p class="notice warning">Partial inventory: first 1,500 keys shown.</p>{/if}
        <div class="cache-workspace">
          <div class="request-list">
            <div class="filter-bar"><Icon name="search" /><input bind:value={cacheQuery} type="search" aria-label="Filter cached request URLs" placeholder="Filter URLs" /><span class="secondary numeric">{visibleEntries.length}</span></div>
            <div class="table-scroll">
              <table class="data-table request-table"><thead><tr><th scope="col" class="index-column">#</th><th scope="col">Request URL</th><th scope="col" class="method-column">Method</th><th scope="col" class="mode-column">Mode</th></tr></thead><tbody>
                {#each visibleEntries as entry, index (entry.requestKey)}
                  <tr class:selected={selectedRequestKey === entry.requestKey}><td class="number-cell">{index + 1}</td><td><button class="cell-button request-button" title={entry.url} aria-label={`${entry.method} ${entry.url}`} aria-pressed={selectedRequestKey === entry.requestKey} onclick={() => showDetails(entry.requestKey)} onkeydown={(event) => navigateRequests(event, index)}><Icon name="file" size={12} /><span>{requestPath(entry.url)}</span></button></td><td class="mono">{entry.method}</td><td class="secondary">{entry.mode ?? '—'}</td></tr>
                {:else}<tr><td colspan="4" class="table-empty">{working.startsWith('cache:') ? 'Loading request keys…' : cacheQuery ? 'No matching request keys.' : 'This cache has no visible keys.'}</td></tr>{/each}
              </tbody></table>
            </div>
            <div class="table-footer">{selectedInventory?.partial ? 'Partial inventory' : 'Cached requests'}<span class="toolbar-space"></span><span>Metadata only</span></div>
          </div>
          <aside class="details-pane" aria-label="Selected response">
            <div class="pane-toolbar"><h2>Response</h2></div>
            <div class="details-scroll">
              {#if selectedEntry}<div class="request-location"><code>{selectedEntry.url}</code></div>{/if}
              {#if operationError?.area === 'details'}<p class="notice error" role="alert">{operationError.message}</p>{/if}
              {#if selectedDetails}
                <dl class="properties response-properties"><div><dt>Status</dt><dd>{selectedDetails.status ?? 'Opaque / unreadable'}</dd></div><div><dt>Content type</dt><dd><code>{selectedDetails.contentType ?? 'Not available'}</code></dd></div></dl>
                <details class="headers"><summary>Response headers <span class="secondary">({selectedDetails.headers.length})</span></summary><p class="footnote">Headers may contain sensitive values.</p><dl class="header-properties">{#each selectedDetails.headers as header, index (index)}<div><dt>{header[0]}</dt><dd>{header[1]}</dd></div>{/each}</dl></details>
                <h3 class="section-title">Preview</h3>
                {#if selectedDetails.preview.kind === 'not-requested' && selectedRequestKey}<div class="preview-action"><button onclick={() => showDetails(selectedRequestKey!, true)} disabled={working.startsWith('entry:')}>{working.startsWith('entry:') ? 'Loading…' : 'Load text / JSON'}</button><p class="footnote">Response body is read only on request.</p></div>
                {:else if selectedDetails.preview.kind === 'text'}<pre class="preview">{selectedDetails.preview.text}</pre>
                {:else}<p class="inline-empty">{selectedDetails.preview.kind === 'opaque' ? 'The response body is opaque.' : selectedDetails.preview.kind === 'too-large' ? 'The response exceeds the preview limit.' : 'Text preview is unavailable for this response.'}</p>{/if}
              {:else}<p class="inline-empty">{working.startsWith('entry:') ? 'Reading response metadata…' : 'Select a request to view its response.'}</p>{/if}
            </div>
          </aside>
        </div>
        {#if selectedMeasurement}<div class="measurement-strip"><strong>{formatBytes(selectedMeasurement.bodyBytes)}</strong> known body bytes<span class="measurement-counts">{selectedMeasurement.entries} scanned · {selectedMeasurement.unknownEntries} unknown · {selectedMeasurement.failedEntries} failed{selectedMeasurement.complete ? '' : ' · incomplete'}</span></div>{/if}

      {:else if view === 'offline'}
        <div class="pane-toolbar"><h1>Offline Resources</h1><span class="secondary">Cache key lookup</span></div>
        <div class="offline-input"><label for="offline-paths">Same-origin URLs or paths, one per line</label><textarea id="offline-paths" bind:value={offlinePaths} rows="4" spellcheck="false"></textarea><div class="input-actions"><button onclick={checkOffline} disabled={!overview || working === 'offline'}>{working === 'offline' ? 'Checking…' : 'Check keys'}</button><span class="secondary">Up to 30 paths · No network requests</span></div></div>
        {#if operationError?.area === 'offline'}<p class="notice error" role="alert">{operationError.message}</p>{/if}
        <div class="table-scroll"><table class="data-table offline-table"><thead><tr><th scope="col">Path</th><th scope="col">Cache match</th><th scope="col">Status</th></tr></thead><tbody>{#each offlineChecks as check, index (index)}<tr><td><code>{check.input}</code></td><td class:success={check.found} class:error-text={!!check.error}>{check.error ? check.error.message : check.found ? 'Present' : 'Not present'}</td><td>{check.found ? check.status ?? 'Opaque' : '—'}</td></tr>{:else}<tr><td colspan="3" class="table-empty">{overview ? 'Enter paths and check for cached responses.' : 'Refresh the inspected origin before checking paths.'}</td></tr>{/each}</tbody></table></div>
        <p class="bottom-note">A cached response does not guarantee that the page works offline.</p>

      {:else}
        <div class="pane-toolbar"><h1>Diagnostics</h1><span class="toolbar-space"></span><button onclick={runDevToolsProbe}>Run bridge probe</button></div>
        <div class="content-scroll"><h2 class="section-title">Safari bridge</h2><dl class="properties"><div><dt>Imported API</dt><dd><code>{devToolsBinding.selectedNamespace}</code></dd></div><div><dt>Native browser</dt><dd>Runtime ID {devToolsBinding.browserRuntimeId ? 'present' : 'missing'} · eval {devToolsBinding.browserHasInspectedWindowEval ? 'present' : 'missing'}</dd></div><div><dt>Chrome compatibility</dt><dd>Runtime ID {devToolsBinding.chromeRuntimeId ? 'present' : 'missing'} · eval {devToolsBinding.chromeHasInspectedWindowEval ? 'present' : 'missing'}</dd></div></dl><h2 class="section-title">Probe results</h2><div class="probe-results">{#each probeResults as probe (probe.label)}<div><strong>{probe.label}</strong><code>{probe.outcome}</code></div>{:else}<p class="inline-empty">No probe has run in this Inspector session.</p>{/each}</div><p class="footnote">The probe evaluates fixed test expressions. It does not change website data.</p></div>
      {/if}
    </section>
  </div>

  <footer class="statusbar"><span class:error-text={!!inspectionError} aria-live="polite">{loading ? 'Refreshing…' : inspectionError ? 'Refresh failed' : overview ? overview.controller ? 'Controlled' : 'Not controlled' : 'Not inspected'}</span>{#if lastUpdated}<span class="snapshot-time">Updated {lastUpdated}</span>{/if}<span class="toolbar-space"></span><span class="navigation-note" title="Safari may not report navigation with temporary site access. Refresh after navigating.">Refresh after navigation</span></footer>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { color-scheme: light dark; }
  :global(body) { margin: 0; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .inspector {
    --background: #fff; --chrome: #f2f2f2; --sidebar: #f6f6f6; --stripe: #f7f7f7;
    --border: #d0d0d0; --subtle-border: #e6e6e6; --foreground: #242424; --secondary: #626262;
    --selection: #0a62c9; --selected-text: #fff; --hover: #e5e5e5; --button: #fff;
    --success: #24723c; --error: #b42327; --error-bg: #fff1f0; --warning: #7b5900; --warning-bg: #fff7db;
    display: flex; flex-direction: column; width: 100%; height: 100dvh; min-height: 260px;
    overflow: hidden; background: var(--background); color: var(--foreground); font-variant-numeric: tabular-nums;
  }
  @media (prefers-color-scheme: dark) {
    .inspector { --background: #1e1e1e; --chrome: #2b2b2b; --sidebar: #252525; --stripe: #242424; --border: #424242; --subtle-border: #333; --foreground: #e2e2e2; --secondary: #ababab; --selection: #145caa; --hover: #373737; --button: #383838; --success: #87c99b; --error: #ffaaa7; --error-bg: #3b2424; --warning: #e4c36b; --warning-bg: #373020; }
  }
  :global(::selection) { background: #0a62c9; color: white; }
  h1, h2, h3, p, dl { margin: 0; }
  h1, h2, h3 { font-size: 12px; font-weight: 600; }
  code, .mono, pre { font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  code { overflow-wrap: anywhere; }
  button, input, textarea, select { font: inherit; color: inherit; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 24px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--button); cursor: default; white-space: nowrap; }
  button:hover:not(:disabled) { background: var(--hover); }
  button:active:not(:disabled) { background: var(--border); }
  button:disabled { opacity: .45; }
  button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--selection); outline-offset: -2px; }
  input, textarea, select { min-width: 0; border: 1px solid var(--border); border-radius: 3px; background: var(--background); caret-color: var(--foreground); }
  input::placeholder { color: var(--secondary); opacity: 1; }
  .secondary, .footnote { color: var(--secondary); }
  .success { color: var(--success); }
  .error-text { color: var(--error); }
  .toolbar { display: flex; align-items: center; flex: none; gap: 3px; min-height: 33px; padding: 4px 7px; border-bottom: 1px solid var(--border); background: var(--chrome); }
  .tool-button { border-color: transparent; background: transparent; padding: 2px 6px; }
  .toolbar-divider { height: 16px; border-left: 1px solid var(--border); margin: 0 6px; }
  .origin { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--secondary); font-size: 11px; }
  .read-only { margin-left: auto; padding-left: 10px; color: var(--secondary); font-size: 11px; white-space: nowrap; }
  .workspace { display: flex; flex: 1; min-height: 0; }
  .sidebar { display: flex; flex-direction: column; flex: 0 0 196px; min-width: 0; overflow: auto; padding: 6px 0; border-right: 1px solid var(--border); background: var(--sidebar); }
  .navigation-items { flex: 1; }
  .navigation-row { width: 100%; justify-content: flex-start; min-height: 26px; padding: 3px 10px 3px 22px; border: 0; border-radius: 0; background: transparent; text-align: left; }
  .navigation-row > span:not(.count) { overflow: hidden; text-overflow: ellipsis; }
  .navigation-row .count { margin-left: auto; color: var(--secondary); font-size: 11px; }
  .navigation-row.current, .navigation-row.current:hover { background: var(--selection); color: var(--selected-text); }
  .navigation-row.current .count { color: inherit; }
  .cache-navigation { display: flex; position: relative; }
  .disclosure { z-index: 1; position: absolute; left: 0; width: 20px; height: 26px; padding: 0; border: 0; background: transparent; }
  .disclosure span { display: flex; }
  .disclosure .expanded { transform: rotate(90deg); }
  .cache-heading { padding-left: 22px; }
  .cache-child { padding-left: 39px; font-size: 11px; }
  .tree-empty { display: block; padding: 3px 10px 5px 40px; color: var(--secondary); font-size: 11px; }
  .diagnostic-navigation { margin-top: 16px; }
  .content { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .pane-toolbar { display: flex; align-items: center; gap: 10px; flex: none; min-height: 33px; padding: 4px 10px; border-bottom: 1px solid var(--border); background: var(--chrome); }
  .pane-toolbar h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pane-toolbar > .secondary { flex-shrink: 0; font-size: 11px; }
  .toolbar-space { flex: 1; }
  .content-scroll, .details-scroll { min-height: 0; overflow: auto; }
  .content-scroll { flex: 1; }
  .section-title { display: flex; align-items: center; gap: 6px; margin-top: 16px; padding: 5px 12px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--subtle-border); background: var(--stripe); }
  .content-scroll > .section-title:first-child { margin-top: 0; border-top: 0; }
  .properties { padding: 8px 12px; }
  .properties > div { display: grid; grid-template-columns: 138px minmax(0, 1fr); gap: 12px; min-height: 25px; align-items: baseline; padding: 3px 0; }
  dt { color: var(--secondary); }
  dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .property-script { display: block; margin-top: 2px; color: var(--foreground); }
  .footnote { padding: 5px 12px 12px; font-size: 11px; }
  .empty-state { padding: 22px 18px; }
  .empty-state strong { font-weight: 500; }
  .empty-state p { margin-top: 4px; color: var(--secondary); }
  .inline-empty { padding: 14px 12px; color: var(--secondary); }
  .notice { display: flex; align-items: flex-start; gap: 7px; flex: none; margin: 0; padding: 7px 10px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; font-size: 11px; }
  .notice strong { font-weight: 600; }
  .notice p { margin-top: 2px; }
  .notice.error { color: var(--error); background: var(--error-bg); }
  .notice.warning { color: var(--warning); background: var(--warning-bg); }
  .table-scroll { flex: 1; min-height: 0; overflow: auto; }
  .data-table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 11px; }
  .data-table th { position: sticky; top: 0; z-index: 1; height: 24px; padding: 3px 8px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--chrome); font-weight: 400; text-align: left; white-space: nowrap; }
  .data-table th:last-child { border-right: 0; }
  .data-table td { height: 23px; padding: 2px 8px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .data-table tr:nth-child(even) { background: var(--stripe); }
  .data-table tbody tr:hover { background: var(--hover); }
  .data-table tr.selected, .data-table tr.selected:hover { background: var(--selection); color: var(--selected-text); }
  .data-table tr.selected .secondary { color: inherit; }
  .data-table .number-cell { text-align: right; }
  .data-table .table-empty { padding: 18px 12px; color: var(--secondary); white-space: normal; }
  .cell-button { width: calc(100% + 16px); min-height: 23px; justify-content: flex-start; margin: -2px -8px; padding: 2px 8px; border: 0; border-radius: 0; background: transparent; text-align: left; font-size: 11px; }
  .cell-button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell-button:hover:not(:disabled) { background: transparent; }
  .selected .cell-button:focus-visible { outline-color: #fff; }
  .cache-table th:first-child { width: 65%; }
  .cache-table th:nth-child(2) { width: 70px; }
  .cache-workspace { display: flex; flex: 1; min-height: 0; }
  .request-list { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .filter-bar { display: flex; align-items: center; gap: 7px; flex: none; min-height: 32px; padding: 4px 8px; border-bottom: 1px solid var(--border); color: var(--secondary); }
  .filter-bar input { width: 100%; height: 23px; padding: 2px 6px; color: var(--foreground); font-size: 11px; }
  .request-table { min-width: 420px; }
  .request-table .index-column { width: 36px; }
  .method-column { width: 62px; }
  .mode-column { width: 76px; }
  .table-footer { display: flex; gap: 12px; flex: none; min-height: 24px; padding: 4px 8px; border-top: 1px solid var(--border); color: var(--secondary); font-size: 10px; }
  .details-pane { display: flex; flex-direction: column; flex: 0 0 32%; min-width: 255px; max-width: 440px; border-left: 1px solid var(--border); }
  .request-location { padding: 10px 12px; border-bottom: 1px solid var(--subtle-border); }
  .response-properties > div { grid-template-columns: 76px minmax(0, 1fr); gap: 8px; }
  .headers { border-top: 1px solid var(--border); }
  .headers summary { padding: 6px 12px; cursor: default; font-weight: 500; }
  .header-properties { padding: 0 12px 8px; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .header-properties div { padding-bottom: 8px; }
  .header-properties dt { overflow-wrap: anywhere; }
  .header-properties dd { padding-left: 12px; }
  .details-scroll .section-title { margin-top: 0; }
  .preview-action { padding: 10px 12px; }
  .preview-action .footnote { padding: 6px 0 0; }
  .preview { overflow: auto; margin: 0; padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
  .measurement-strip { display: flex; flex-wrap: wrap; gap: 4px; flex: none; padding: 5px 10px; border-top: 1px solid var(--border); font-size: 11px; }
  .measurement-counts { margin-left: auto; color: var(--secondary); }
  .offline-input { padding: 12px; border-bottom: 1px solid var(--border); }
  .offline-input label { display: block; margin-bottom: 6px; }
  textarea { display: block; width: 100%; padding: 6px 8px; resize: vertical; max-height: 220px; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .input-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; font-size: 11px; }
  .offline-table th:first-child { width: 50%; }
  .offline-table th:last-child { width: 75px; }
  .offline-table td { white-space: normal; overflow-wrap: anywhere; }
  .bottom-note { flex: none; padding: 7px 10px; border-top: 1px solid var(--border); color: var(--secondary); font-size: 11px; }
  .probe-results > div { padding: 8px 12px; border-bottom: 1px solid var(--subtle-border); }
  .probe-results strong { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 500; }
  .probe-results code { display: block; color: var(--secondary); white-space: pre-wrap; }
  .statusbar { display: flex; gap: 12px; align-items: center; flex: none; min-height: 24px; padding: 3px 10px; border-top: 1px solid var(--border); background: var(--chrome); color: var(--secondary); font-size: 10px; white-space: nowrap; }
  .compact-navigation { display: none; }
  @media (max-width: 950px) {
    .sidebar { flex-basis: 174px; }
    .cache-workspace { flex-direction: column; }
    .request-list { flex: 1 1 55%; min-height: 150px; }
    .details-pane { flex: 1 1 45%; max-width: none; min-height: 120px; min-width: 0; border-left: 0; border-top: 1px solid var(--border); }
  }
  @media (max-width: 600px) {
    .sidebar { display: none; }
    .compact-navigation { display: flex; align-items: center; gap: 8px; flex: none; min-height: 34px; padding: 4px 8px; border-bottom: 1px solid var(--border); background: var(--sidebar); }
    .compact-navigation label { color: var(--secondary); font-size: 11px; }
    .compact-navigation select { flex: 1; height: 26px; max-width: 100%; }
    .read-only { display: none; }
    .toolbar { min-height: 35px; }
    .properties > div { grid-template-columns: 108px minmax(0, 1fr); gap: 8px; }
    .cache-toolbar { flex-wrap: wrap; gap: 5px 8px; }
    .cache-toolbar h1 { max-width: calc(100% - 75px); }
    .cache-toolbar .toolbar-space { flex-basis: 100%; height: 0; }
    .snapshot-time { display: none; }
    .input-actions { align-items: start; }
    .input-actions > span { max-width: 180px; }
  }
  @media (prefers-reduced-motion: reduce) { :global(*), :global(*::before), :global(*::after) { scroll-behavior: auto !important; } }
</style>
