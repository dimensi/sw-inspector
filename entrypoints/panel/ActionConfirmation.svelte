<script lang="ts">
  import { onMount } from 'svelte';
  import type { ActionTicket } from '../../src/domain/actions';

  let { ticket, busy, onconfirm, oncancel, restoreFocus }: {
    ticket: ActionTicket;
    busy: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    restoreFocus?: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let cancelButton: HTMLButtonElement;
  let runningMessage = $state<HTMLParagraphElement>();
  $effect(() => { if (busy) runningMessage?.focus(); });
  const id = $props.id();

  onMount(() => {
    const previousFocus = document.activeElement;
    dialog.showModal();
    cancelButton.focus();
    return () => {
      dialog.close();
      queueMicrotask(() => {
        if (restoreFocus) restoreFocus();
        else if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      });
    };
  });

  function containBusyFocus(event: KeyboardEvent) {
    if (busy && event.key === 'Tab') { event.preventDefault(); runningMessage?.focus(); }
  }

  function cancel(event: Event) {
    event.preventDefault();
    if (!busy) oncancel();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="{id}-title" aria-describedby="{id}-summary" oncancel={cancel} onkeydown={containBusyFocus}>
  <h2 id="{id}-title">Confirm action</h2>
  <dl>
    <dt>Origin</dt><dd>{ticket.page.origin}</dd>
    <dt>Page URL</dt><dd>{ticket.page.url}</dd>
  </dl>
  <ul id="{id}-summary">
    {#each ticket.summary as line, index (index)}<li>{line}</li>{/each}
  </ul>
  {#if busy}<p bind:this={runningMessage} tabindex="-1" role="status">Action running. Waiting for the outcome…</p>{/if}
  <footer>
    <button bind:this={cancelButton} onclick={oncancel} disabled={busy}>Cancel</button>
    <button onclick={onconfirm} disabled={busy}>{busy ? 'Running…' : 'Confirm'}</button>
  </footer>
</dialog>

<style>
  button { font: inherit; color: inherit; min-height: 24px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--button); }
  button:hover:not(:disabled) { background: var(--hover); }
  button:active:not(:disabled) { background: var(--border); }
  button:disabled { opacity: .45; }
  button:focus-visible { outline: 2px solid var(--selection); outline-offset: -2px; }
  dialog { box-sizing: border-box; width: min(480px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); margin: auto; padding: 0; overflow: auto; border: 1px solid var(--border); border-radius: 3px; color: var(--foreground); background: var(--background); font: inherit; }
  h2 { margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--stripe); font-size: 12px; font-weight: 600; }
  dl { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 6px 8px; margin: 12px; }
  dt { color: var(--secondary); }
  dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  ul { margin: 12px; padding-left: 16px; overflow-wrap: anywhere; }
  p { margin: 12px; }
  footer { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--border); background: var(--chrome); }
</style>
