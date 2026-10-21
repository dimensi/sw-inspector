<script lang="ts">
  import type { ActionIntent } from '../../src/domain/actions';
  import type { Registration } from '../../src/domain/types';

  let { registrations, disabled, onintent }: {
    registrations: Registration[];
    disabled: boolean;
    onintent: (intent: ActionIntent) => void;
  } = $props();
  let selection = $state.raw<{ registrations: Registration[]; id: string } | null>(null);
  const selectedId = $derived(selection?.registrations === registrations ? selection.id : '');
  const available = $derived(registrations.some(row => !!row.registrationId));
  function request(kind: 'update-worker' | 'unregister-worker', trigger: HTMLButtonElement) {
    if (!disabled && selectedId && registrations.some(row => row.registrationId === selectedId)) {
      // Safari mouse activation need not focus a native button automatically.
      trigger.focus();
      onintent({ kind, registrationId: selectedId });
    }
  }
</script>

<div class="worker-controls">
  <select aria-label="Registration" value={selectedId} disabled={disabled || !available}
    onchange={event => { selection = { registrations, id: event.currentTarget.value }; }}>
    <option value="">Select registration</option>
    {#each registrations as registration, index (registration.registrationId ?? index)}
      <option value={registration.registrationId ?? ''} disabled={!registration.registrationId}>{registration.scope}</option>
    {/each}
  </select>
  <button disabled={disabled || !selectedId} onclick={event => request('update-worker', event.currentTarget)}>Check for update</button>
  <button disabled={disabled || !selectedId} onclick={event => request('unregister-worker', event.currentTarget)}>Unregister</button>
  {#if registrations.length && !available}<span class="management-note">Management unavailable for this snapshot.</span>{/if}
</div>

<style>
  .worker-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-width: 0; }
  select, button { min-height: 24px; font: inherit; color: inherit; border: 1px solid var(--border); border-radius: 3px; background: var(--button); }
  select { flex: 1 1 180px; min-width: 0; max-width: 300px; height: 24px; background: var(--background); }
  button { padding: 2px 8px; white-space: nowrap; }
  button:hover:not(:disabled) { background: var(--hover); }
  button:active:not(:disabled) { background: var(--border); }
  button:disabled, select:disabled { opacity: .45; }
  button:focus-visible, select:focus-visible { outline: 2px solid var(--selection); outline-offset: -2px; }
  .management-note { color: var(--secondary); font-size: 11px; }
</style>
