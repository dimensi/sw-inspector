import type { PageContext } from '../bridge/page-context';
import type { PageIdentity, Result } from '../domain/types';
import type { formatMessagePreview } from './preview';
import type { MessageSessionRecord } from './session-types';
import type { MessageBatch, MessageRecord, MessageSession, MessagingCommand } from './types';

// Serialized into the inspected document; formatter is explicitly injected.
export function createMessageRunner(context: PageContext, formatPreview: typeof formatMessagePreview): (command: MessagingCommand) => Promise<Result<MessageSession | MessageBatch | { stopped: true }>> {
  type Runtime = { active: MessageSessionRecord | null; timer?: ReturnType<typeof setTimeout> };
  const runtimeKey = 'message:runtime:v1';
  function bytes(row: MessageRecord) { return new TextEncoder().encode(JSON.stringify(row)).byteLength; }
  function close(runtime: Runtime, record: MessageSessionRecord) {
    if (runtime.active === record) { clearTimeout(runtime.timer); runtime.timer = undefined; runtime.active = null; }
    for (const cleanup of record.cleanups) { try { cleanup(); } catch { /* Close remaining owned resources. */ } }
    record.cleanups.clear();
    for (const port of record.ports) { try { port.close(); } catch { /* A transferred endpoint may already be closed. */ } }
    record.ports.clear(); record.rows.length = 0; record.byteCount = 0; record.listening = false;
    context.messages.delete(record.id);
  }
  function arm(runtime: Runtime) {
    clearTimeout(runtime.timer);
    const record = runtime.active;
    if (!record) { runtime.timer = undefined; return; }
    runtime.timer = setTimeout(() => {
      if (!context.isCurrent(record.identity) || record.expiresAt <= Date.now()) close(runtime, record);
      else arm(runtime);
    }, Math.max(0, record.expiresAt - Date.now()));
  }
  function runtime(): Runtime {
    let current = context.messages.get(runtimeKey) as Runtime | undefined;
    if (!current) {
      current = { active: null }; context.messages.set(runtimeKey, current);
      const owned = current;
      context.onDispose(() => { if (owned.active) close(owned, owned.active); clearTimeout(owned.timer); owned.timer = undefined; });
    }
    if (current.active && (!context.isCurrent(current.active.identity) || current.active.expiresAt <= Date.now())) close(current, current.active);
    return current;
  }
  function source(event: MessageEvent): string | null {
    try { const sender = event.source; if (sender && 'scriptURL' in sender) { const url = sender.scriptURL; return typeof url === 'string' ? url : null; } } catch { /* Metadata is optional, never authentication. */ }
    return null;
  }
  return async command => {
    if (!context.isCurrent(command.expectedPage)) return { ok: false, error: { code: 'stale-target', message: 'The inspected page changed. Open a new message session.' } };
    const state = runtime();
    if (command.type === 'open-message-session') {
      if (state.active) close(state, state.active);
      const identity = { ...context.identity() };
      const record: MessageSessionRecord = {
        identity, id: crypto.randomUUID(), expiresAt: Date.now() + 10000, nextSeq: 0, dropped: 0,
        rows: [], byteCount: 0, listening: false, cleanups: new Set(), ports: new Set(),
        append(row) {
          if (!context.isCurrent(identity) || record.expiresAt <= Date.now() || state.active !== record) { close(state, record); return; }
          const seq = ++record.nextSeq;
          // Preflight unbounded metadata before serializing a row. Oversized rows
          // are dropped honestly rather than truncating a URL into another target.
          if (row.text.length > 131072 || (row.sourceURL?.length ?? 0) > 131072 || (row.requestId?.length ?? 0) > 131072) { record.dropped++; return; }
          const item: MessageRecord = { ...row, seq, timestamp: Date.now() };
          const size = bytes(item);
          if (size > 131072) { record.dropped++; return; }
          record.rows.push(item); record.byteCount += size;
          while (record.rows.length > 500 || record.byteCount > 2 * 1024 * 1024) {
            record.byteCount -= bytes(record.rows.shift()!); record.dropped++;
          }
        },
      };
      state.active = record; context.messages.set(record.id, record); arm(state);
      return { ok: true, value: { sessionId: record.id, page: { ...identity }, expiresAt: record.expiresAt } };
    }
    const record = context.messages.get(command.sessionId) as MessageSessionRecord | undefined;
    if (!record || state.active !== record || !context.isCurrent(record.identity) || record.expiresAt <= Date.now()) {
      return { ok: false, error: { code: 'stale-target', message: 'Message session expired. Open a new session explicitly.' } };
    }
    if (command.type === 'stop-message-session') { close(state, record); return { ok: true, value: { stopped: true } }; }
    if (command.type === 'start-message-listener') {
      if (!('serviceWorker' in navigator)) return { ok: false, error: { code: 'unsupported', message: 'Service Worker API is unavailable.' } };
      if (!record.listening) {
        const container = navigator.serviceWorker;
        const message = (event: MessageEvent) => { const preview = formatPreview(event.data); record.append({ direction: 'incoming', sourceURL: source(event), requestId: null, text: preview.text, truncated: preview.truncated, status: 'received' }); };
        const error = (event: MessageEvent) => { record.append({ direction: 'incoming', sourceURL: source(event), requestId: null, text: 'Message could not be deserialized.', truncated: false, status: 'message-error' }); };
        container.addEventListener('message', message); container.addEventListener('messageerror', error);
        record.cleanups.add(() => { container.removeEventListener('message', message); container.removeEventListener('messageerror', error); });
        record.listening = true;
      }
      return { ok: true, value: { sessionId: record.id, page: { ...record.identity }, expiresAt: record.expiresAt } };
    }
    if (command.type === 'read-message-events') {
      if (!Number.isSafeInteger(command.afterSeq) || command.afterSeq < 0) return { ok: false, error: { code: 'invalid-command', message: 'Invalid message cursor.' } };
      record.expiresAt = Date.now() + 10000; arm(state);
      const rows: MessageRecord[] = []; let byteCount = 0;
      for (const row of record.rows) {
        if (row.seq <= command.afterSeq) continue;
        const size = bytes(row);
        if (rows.length >= 50 || byteCount + size > 131072) break;
        rows.push({ ...row }); byteCount += size;
      }
      return { ok: true, value: { sessionId: record.id, records: rows, nextSeq: rows.at(-1)?.seq ?? command.afterSeq, dropped: record.dropped, listening: record.listening, expiresAt: record.expiresAt } };
    }
    return { ok: false, error: { code: 'invalid-command', message: 'Unknown message command.' } };
  };
}
