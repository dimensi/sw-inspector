import type { ActionIntent, ActionReceipt, ActionTicket, ControlCommand } from '../domain/actions';
import type { PageIdentity, Result } from '../domain/types';

export type ActionState = {
  phase: 'idle' | 'preparing' | 'confirming' | 'running' | 'result';
  ticket: ActionTicket | null;
  receipt: ActionReceipt | null;
  error: string | null;
};
type Dependencies = {
  invoke: <T>(command: ControlCommand) => Promise<Result<T>>;
  getPage: () => PageIdentity | null;
  onState: (state: ActionState) => void;
  onSettled: (receipt: ActionReceipt | null) => Promise<void>;
};
const idle = (): ActionState => ({ phase: 'idle', ticket: null, receipt: null, error: null });
const samePage = (a: PageIdentity | null, b: PageIdentity) => a?.documentId === b.documentId && a.origin === b.origin && a.url === b.url;
const copyTicket = (ticket: ActionTicket): ActionTicket => ({ ...ticket, page: { ...ticket.page }, summary: [...ticket.summary] });

export function createActionController(deps: Dependencies) {
  let state = idle();
  let version = 0;
  let running = false;
  let retained: ActionTicket | null = null;
  function publish(next: ActionState) {
    state = next;
    deps.onState({ ...next, ticket: next.ticket ? copyTicket(next.ticket) : null,
      receipt: next.receipt ? { ...next.receipt, items: next.receipt.items.map(item => ({ ...item })) } : null });
  }
  function reset() { version += 1; retained = null; publish(idle()); }
  publish(state);
  async function prepare(intent: ActionIntent, directEntry = false) {
    const page = deps.getPage();
    if (!page || running || state.phase === 'preparing' || state.phase === 'confirming') return;
    const expectedPage = { ...page };
    const operation = ++version;
    retained = null;
    publish({ ...idle(), phase: 'preparing' });
    const result = await deps.invoke<ActionTicket>({ type: 'prepare-action', expectedPage, intent: { ...intent } });
    if (operation !== version) return;
    if (!samePage(deps.getPage(), expectedPage)) { reset(); return; }
    if (!result.ok) { publish({ ...idle(), phase: 'result', error: result.error.message }); return; }
    const ticket = copyTicket(result.value);
    if (directEntry) {
      if (ticket.kind !== 'delete-cache-entry' || !samePage(expectedPage, ticket.page) || ticket.expiresAt <= Date.now()) { publish({ ...idle(), phase: 'result', error: 'The entry action expired or changed. Refresh and try again.' }); return; }
      await commit(ticket, operation);
    } else {
      retained = ticket;
      publish({ ...idle(), phase: 'confirming', ticket: retained });
    }
  }
  async function commit(ticket: ActionTicket, operation: number) {
    if (running || operation !== version) return;
    if (!samePage(deps.getPage(), ticket.page)) {
      retained = null;
      publish({ ...idle(), phase: 'result', error: 'The inspected page changed. Refresh and prepare the action again.' });
      return;
    }
    running = true;
    publish({ ...idle(), phase: 'running', ticket });
    try {
      const result = await deps.invoke<ActionReceipt>({ type: 'commit-action', expectedPage: { ...ticket.page }, ticketId: ticket.ticketId });
      if (operation !== version) return;
      if (!samePage(deps.getPage(), ticket.page)) { reset(); return; }
      retained = null;
      publish({ ...idle(), phase: 'result', receipt: result.ok ? result.value : null, error: result.ok ? null : result.error.message });
      if (result.ok || result.error.code === 'outcome-unknown') {
        // Refresh errors belong to the inspection surface, never to the action outcome.
        try { await deps.onSettled(result.ok ? result.value : null); } catch { /* Preserve the published outcome. */ }
      }
    } finally { running = false; }
  }
  return {
    prepare: (intent: ActionIntent) => prepare(intent),
    deleteEntry: (intent: Extract<ActionIntent, { kind: 'delete-cache-entry' }>) => {
      if (intent.kind !== 'delete-cache-entry') return Promise.resolve();
      return prepare(intent, true);
    },
    async confirm() {
      if (state.phase !== 'confirming' || !retained) return;
      await commit(retained, version);
    },
    cancel() { if (state.phase !== 'running') reset(); },
    reset,
  };
}
