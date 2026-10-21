import type { PageIdentity, Result } from '../domain/types';
import type { MessageBatch, MessageRecord, MessageSession, MessagingCommand } from '../messages/types';
export type MessageSessionState = { session: MessageSession | null; rows: MessageRecord[]; listening: boolean; error: string | null; dropped: number };
type Dependencies = { invoke: <T>(command: MessagingCommand) => Promise<Result<T>>; getPage: () => PageIdentity | null; onState: (state: MessageSessionState) => void };
export function createMessageSessionController(deps: Dependencies) {
  let state: MessageSessionState = { session: null, rows: [], listening: false, error: null, dropped: 0 };
  let version = 0; let disposed = false; let cursor = 0; let localDropped = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let opening: Promise<MessageSession | null> | null = null;
  let reading: Promise<void> | null = null;
  const same = (a: PageIdentity | null, b: PageIdentity) => a?.documentId === b.documentId && a.origin === b.origin && a.url === b.url;
  const size = (row: MessageRecord) => new TextEncoder().encode(JSON.stringify(row)).byteLength;
  function publish() { deps.onState({ ...state, rows: state.rows.map(row => ({ ...row })), session: state.session ? { ...state.session, page: { ...state.session.page } } : null }); }
  async function release(session: MessageSession | null) {
    if (!session) return;
    try { await deps.invoke({ type: 'stop-message-session', expectedPage: session.page, sessionId: session.sessionId }); } catch { /* Lease bounds cleanup when the panel cannot reach the page. */ }
  }
  function end(error: string | null, clearRows: boolean) {
    version++; clearTimeout(timer); timer = undefined; reading = null; opening = null;
    const previous = state.session;
    state = { ...state, session: null, listening: false, error, ...(clearRows ? { rows: [], dropped: 0 } : {}) };
    publish(); void release(previous);
  }
  function current(operation: number, session: MessageSession) { return !disposed && operation === version && state.session?.sessionId === session.sessionId && same(deps.getPage(), session.page); }
  function schedule() { clearTimeout(timer); if (!disposed && state.session) timer = setTimeout(() => { void read(); }, 1000); }
  function read(): Promise<void> {
    if (reading) return reading;
    const session = state.session;
    if (disposed || !session) return Promise.resolve();
    if (!same(deps.getPage(), session.page)) { end('The inspected page changed. Start a new session.', true); return Promise.resolve(); }
    clearTimeout(timer); const operation = version;
    const pending = (async () => {
      try {
        const result = await deps.invoke<MessageBatch>({ type: 'read-message-events', expectedPage: session.page, sessionId: session.sessionId, afterSeq: cursor });
        if (!current(operation, session)) { if (operation === version && !disposed) end('The inspected page changed. Start a new session.', true); return; }
        if (!result.ok) { end(result.error.message, true); return; }
        const batch = result.value;
        if (batch.sessionId !== session.sessionId) { end('The message session changed. Start again explicitly.', true); return; }
        const rows = [...state.rows, ...batch.records.filter(row => row.seq > cursor)];
        cursor = Math.max(cursor, batch.nextSeq);
        let bytes = rows.reduce((sum, row) => sum + size(row), 0);
        while (rows.length > 500 || bytes > 2 * 1024 * 1024) { bytes -= size(rows.shift()!); localDropped++; }
        state = { session: { ...session, expiresAt: batch.expiresAt }, rows, listening: batch.listening, error: null, dropped: Math.max(batch.dropped, localDropped) }; publish();
      } catch { if (current(operation, session)) end('Unable to read messages. Start a new session explicitly.', true); }
    })();
    reading = pending;
    void pending.finally(() => { if (reading === pending) { reading = null; schedule(); } });
    return pending;
  }
  function open(): Promise<MessageSession | null> {
    if (disposed) return Promise.resolve(null);
    if (state.session && same(deps.getPage(), state.session.page)) return Promise.resolve(state.session);
    if (opening) return opening;
    const page = deps.getPage(); if (!page) return Promise.resolve(null);
    const operation = ++version; const expectedPage = { ...page };
    state = { session: null, rows: [], listening: false, error: null, dropped: 0 }; cursor = 0; localDropped = 0; publish();
    const pending = (async () => {
      try {
        const result = await deps.invoke<MessageSession>({ type: 'open-message-session', expectedPage });
        if (disposed || operation !== version || !same(deps.getPage(), expectedPage)) { if (result.ok) void release(result.value); return null; }
        if (!result.ok) { state.error = result.error.message; publish(); return null; }
        if (!same(result.value.page, expectedPage)) { void release(result.value); state.error = 'The inspected page changed. Start again explicitly.'; publish(); return null; }
        state.session = result.value; publish(); void read(); return result.value;
      } catch { if (!disposed && operation === version) { state.error = 'Unable to open a message session.'; publish(); } return null; }
    })();
    opening = pending; void pending.finally(() => { if (opening === pending) opening = null; }); return pending;
  }
  publish();
  return {
    open, read,
    async startListening() {
      const session = await open(); if (!session || disposed) return;
      const operation = version;
      await read(); if (!current(operation, session)) return;
      try {
        const result = await deps.invoke<MessageSession>({ type: 'start-message-listener', expectedPage: session.page, sessionId: session.sessionId });
        if (!current(operation, session)) return;
        if (!result.ok) { end(result.error.message, true); return; }
        state = { ...state, session: result.value, listening: true, error: null }; publish();
      } catch { if (current(operation, session)) end('Unable to start listening.', true); }
    },
    async stop() { const session = state.session; version++; clearTimeout(timer); timer = undefined; reading = null; opening = null; state = { ...state, session: null, listening: false, error: null }; publish(); await release(session); },
    clearLog() { state = { ...state, rows: [] }; publish(); },
    dispose() { if (disposed) return; disposed = true; end(null, true); },
  };
}
