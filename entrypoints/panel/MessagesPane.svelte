<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { ActionIntent } from '../../src/domain/actions';
  import type { PageIdentity, Registration } from '../../src/domain/types';
  import type { createTransport } from '../../src/bridge/transport';
  import { createMessageSessionController, type MessageSessionState } from '../../src/ui/message-session-controller';
  let { page, registrations, onintent, invoke, busy, settlementToken, refreshToken }: {
    page: PageIdentity | null; registrations: Registration[]; onintent: (intent: ActionIntent) => void;
    invoke: ReturnType<typeof createTransport>['invoke']; busy: boolean; settlementToken: number; refreshToken: number;
  } = $props();
  let sessionState = $state<MessageSessionState>({ session: null, rows: [], listening: false, error: null, dropped: 0 });
  let controller: ReturnType<typeof createMessageSessionController> | null = null;
  let selection = $state.raw<{ registrations: Registration[]; id: string } | null>(null);
  const registrationId = $derived(selection?.registrations === registrations ? selection.id : '');
  const registration = $derived(registrations.find(row => row.registrationId === registrationId));
  let slot = $state<'active' | 'waiting'>('active');
  const worker = $derived(registration?.[slot]);
  let draft = $state(''); let reply = $state(false); let opening = $state(false); let hidden = $state(false);
  let selectedSeq = $state<number | null>(null); let operation = 0;
  const selected = $derived(sessionState.rows.find(row => row.seq === selectedSeq));
  const validation = $derived.by(() => {
    if (!draft.length) return 'Enter a JSON value.';
    if (draft.length > 16384 || new TextEncoder().encode(draft).byteLength > 16384) return 'JSON must be at most 16 KiB UTF-8.';
    try { JSON.parse(draft); return null; } catch { return 'Enter valid JSON.'; }
  });
  const disabled = $derived(busy || opening || hidden);
  function reset() {
    operation++; controller?.dispose(); selection = null; slot = 'active'; draft = ''; reply = false; opening = false; selectedSeq = null;
    controller = createMessageSessionController({ invoke: command => invoke(command), getPage: () => page,
      onState: next => { sessionState = next; if (next.error) { draft = ''; reply = false; selection = null; selectedSeq = null; } } });
  }
  // Page/reset changes own an imperative session lifecycle, not derived data.
  $effect(() => {
    page?.documentId; page?.origin; page?.url; refreshToken;
    untrack(reset);
    return () => { operation++; controller?.dispose(); controller = null; };
  });
  // Settlement explicitly reads the existing buffer; it never refreshes overview.
  $effect(() => { const token = settlementToken; if (token) untrack(() => { void controller?.read(); }); });
  onMount(() => {
    const hide = () => { if (document.visibilityState === 'hidden') { hidden = true; reset(); } else hidden = false; };
    const close = () => { hidden = true; reset(); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', close);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', close); };
  });
  async function send(trigger: HTMLButtonElement) {
    if (disabled || !page || !registrationId || !worker?.workerId || worker.state === 'redundant' || validation || !controller) return;
    const current = controller; const version = ++operation;
    const intent = { kind: 'send-worker-message' as const, registrationId, workerId: worker.workerId, slot, jsonText: draft, reply: reply ? 'port' as const : 'none' as const };
    opening = true;
    const session = await current.open();
    if (version !== operation || current !== controller) return;
    opening = false; await tick();
    if (version !== operation || current !== controller || !session || hidden || busy || !trigger.isConnected
      || page?.documentId !== session.page.documentId || page.origin !== session.page.origin || page.url !== session.page.url
      || registrationId !== intent.registrationId || worker?.workerId !== intent.workerId || slot !== intent.slot) return;
    trigger.focus(); onintent({ ...intent, sessionId: session.sessionId });
  }
  async function start() {
    if (disabled || !controller || !page) return;
    const version = ++operation; const current = controller; opening = true;
    await current.startListening(); if (version === operation) opening = false;
  }
  function move(event: KeyboardEvent, index: number) {
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? sessionState.rows.length - 1 : -1;
    if (next < 0 || next >= sessionState.rows.length) return;
    event.preventDefault(); selectedSeq = sessionState.rows[next].seq;
    const table = event.currentTarget instanceof HTMLElement ? event.currentTarget.closest('tbody') : null;
    table?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }
</script>

<div class="pane-toolbar"><h1>Messages</h1><span class="status" aria-live="polite">{opening ? 'Opening session…' : sessionState.listening ? 'Listening' : sessionState.session ? 'Session open · Not listening' : 'Not listening'}</span></div>
<div class="composer">
  <div class="target-fields"><label>Registration<select aria-label="Message registration" value={registrationId} disabled={disabled || !page} onchange={event => { selection = { registrations, id: event.currentTarget.value }; }}><option value="">Select registration</option>{#each registrations as row, index (row.registrationId ?? index)}<option value={row.registrationId ?? ''} disabled={!row.registrationId}>{row.scope}</option>{/each}</select></label>
    <label>Worker<select aria-label="Message worker slot" bind:value={slot} disabled={disabled || !registrationId}><option value="active" disabled={!registration?.active?.workerId}>Active</option><option value="waiting" disabled={!registration?.waiting?.workerId}>Waiting</option></select></label></div>
  {#if worker}<p class="target-url"><code>{worker.scriptURL}</code></p>{/if}
  <label for="message-json">JSON payload <span class="secondary">· 16 KiB UTF-8 maximum</span></label>
  <textarea id="message-json" bind:value={draft} maxlength="16384" rows="3" spellcheck="false" disabled={disabled} aria-describedby="json-validation"></textarea>
  <div class="compose-actions"><label class="reply"><input type="checkbox" bind:checked={reply} disabled={disabled} />Request reply on supplied port</label><button disabled={disabled || !page || !registrationId || !worker?.workerId || worker.state === 'redundant' || !!validation} onclick={event => { void send(event.currentTarget); }}>Send…</button></div>
  <p id="json-validation" class="secondary validation">{validation ?? 'Valid JSON. Sending may change website state.'}</p>
</div>
<div class="pane-toolbar listener-toolbar"><button disabled={disabled || !page || sessionState.listening} onclick={start}>Start listening</button><button disabled={disabled || !sessionState.session} onclick={() => { void controller?.stop(); }}>Stop listening</button><button disabled={!sessionState.rows.length} onclick={() => { controller?.clearLog(); selectedSeq = null; }}>Clear log</button>{#if sessionState.dropped}<span class="status">{sessionState.dropped} dropped · Sequence gaps may occur</span>{/if}</div>
{#if sessionState.error}<p class="notice error" role="alert">{sessionState.error}</p>{/if}
<div class="message-workspace">
  <div class="table-scroll"><table><thead><tr><th>Time</th><th>Direction</th><th>Source</th><th>Status</th></tr></thead><tbody>{#each sessionState.rows as row, index (row.seq)}<tr class:selected={selectedSeq === row.seq}><td><button class="row-button" onclick={() => { selectedSeq = row.seq; }} onkeydown={event => move(event, index)}>{new Date(row.timestamp).toLocaleTimeString()}</button></td><td>{row.direction}</td><td title={row.sourceURL ?? ''}>{row.sourceURL ?? 'Not available'}</td><td>{row.status}</td></tr>{:else}<tr><td colspan="4" class="empty">No messages in this log. Send JSON or choose Start listening to observe messages delivered to this document.</td></tr>{/each}</tbody></table></div>
  <section class="details" aria-label="Message details"><h2>Message details</h2>{#if selected}<dl><div><dt>Sequence</dt><dd>{selected.seq}</dd></div><div><dt>Source</dt><dd><code>{selected.sourceURL ?? 'Not available'}</code></dd></div><div><dt>Request ID</dt><dd><code>{selected.requestId ?? 'Not correlated'}</code></dd></div></dl>{#if selected.truncated}<p class="secondary detail-note">Preview is truncated.</p>{/if}<pre>{selected.text}</pre>{:else}<p class="empty">Select a message to inspect its text.</p>{/if}</section>
</div>
<p class="bottom-note">Listening observes this document only. Source URLs are metadata. A posted message does not confirm delivery.</p>

<style>
  h1,h2,p,dl,pre { margin: 0; } h1,h2 { font-size: 12px; font-weight: 600; }
  .pane-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; flex: none; min-height: 33px; padding: 4px 10px; border-bottom: 1px solid var(--border); background: var(--chrome); }
  .status { color: var(--secondary); font-size: 11px; overflow-wrap: anywhere; } .pane-toolbar h1 { margin-right: auto; }
  button,input,textarea,select { font: inherit; color: inherit; } button,textarea,select { border: 1px solid var(--border); border-radius: 3px; background: var(--button); }
  button { min-height: 24px; padding: 2px 8px; white-space: nowrap; } button:hover:not(:disabled) { background: var(--hover); } button:active:not(:disabled) { background: var(--border); } button:disabled,textarea:disabled,select:disabled,input:disabled { opacity: .45; }
  button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible { outline: 2px solid var(--selection); outline-offset: -2px; }
  .composer { flex: none; max-height: 42dvh; overflow: auto; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  .target-fields { display: flex; gap: 8px; margin-bottom: 7px; } .target-fields label { display: flex; align-items: center; gap: 6px; min-width: 0; } .target-fields label:first-child { flex: 1; }
  select { min-width: 0; height: 24px; background: var(--background); } .target-fields label:first-child select { flex: 1; width: 100%; }
  .target-url { max-height: 48px; overflow: auto; margin-bottom: 7px; } code,pre,textarea { font: 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; } code { overflow-wrap: anywhere; }
  textarea { display: block; width: 100%; min-height: 54px; max-height: 160px; resize: vertical; margin-top: 4px; padding: 5px 7px; background: var(--background); }
  .compose-actions { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 5px; margin-top: 5px; } .reply { display: flex; align-items: center; gap: 4px; font-size: 11px; } .validation { margin-top: 4px; font-size: 11px; } .secondary { color: var(--secondary); }
  .notice { flex: none; margin: 0; padding: 7px 10px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; font-size: 11px; } .error { color: var(--error); background: var(--error-bg); }
  .message-workspace { display: flex; flex: 1; min-height: 0; } .table-scroll { flex: 1; min-width: 0; overflow: auto; }
  table { width: 100%; min-width: 460px; border-spacing: 0; table-layout: fixed; font-size: 11px; } th { position: sticky; top: 0; height: 24px; padding: 3px 8px; border-bottom: 1px solid var(--border); background: var(--chrome); text-align: left; font-weight: 400; } th:first-child { width: 90px; } th:nth-child(2) { width: 80px; } th:last-child { width: 105px; }
  td { height: 23px; padding: 2px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } tr:nth-child(even) { background: var(--stripe); } tbody tr:hover { background: var(--hover); } tr.selected, tr.selected:hover { background: var(--selection); color: var(--selected-text); }
  .row-button { width: calc(100% + 16px); margin: -2px -8px; padding: 2px 8px; min-height: 23px; text-align: left; border: 0; border-radius: 0; background: transparent; font-size: 11px; } .row-button:hover:not(:disabled), .row-button:active:not(:disabled) { background: transparent; } .selected .row-button:focus-visible { outline-color: #fff; }
  .details { flex: 0 0 32%; min-width: 255px; max-width: 440px; overflow: auto; border-left: 1px solid var(--border); } .details h2 { padding: 5px 10px; border-bottom: 1px solid var(--border); background: var(--stripe); } dl { padding: 6px 10px; font-size: 11px; } dl>div { display: grid; grid-template-columns: 70px minmax(0,1fr); gap: 8px; padding: 3px 0; } dt { color: var(--secondary); } dd { min-width: 0; margin: 0; overflow-wrap: anywhere; } pre { padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; } .detail-note { padding: 5px 10px; font-size: 11px; }
  .empty { padding: 14px 10px; color: var(--secondary); white-space: normal; } .bottom-note { flex: none; padding: 6px 10px; border-top: 1px solid var(--border); color: var(--secondary); font-size: 11px; }
  @media(max-width:950px) { .message-workspace { flex-direction: column; } .table-scroll { flex: 1 1 55%; min-height: 100px; } .details { flex: 1 1 45%; min-width: 0; max-width: none; min-height: 90px; border-left: 0; border-top: 1px solid var(--border); } }
  @media(max-width:600px) { .target-fields { flex-wrap: wrap; } .target-fields label:first-child { flex-basis: 100%; } }
</style>
