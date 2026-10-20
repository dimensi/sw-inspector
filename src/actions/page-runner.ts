import type { PageContext } from '../bridge/page-context';
import type { ActionHandlers, ActionIntent, ActionRejection, ActionReceipt, ActionTicket, ControlCommand } from '../domain/actions';
import type { DiagnosticErrorCode, Result } from '../domain/types';

// Serialized into the inspected document: runtime dependencies belong inside this factory.
export function createControlRunner(context: PageContext, handlers: ActionHandlers) {
  type Output = Result<ActionTicket | ActionReceipt>;
  type Record = { ticket: ActionTicket; retained: unknown; handler: NonNullable<ActionHandlers[ActionIntent['kind']]>;
    phase: 'prepared' | 'pending' | 'complete'; completedAt?: number; result?: Output };
  type State = { records: Map<string, Record>; generation: number; closed: boolean };
  // One Inspector/document owns the ledger, including across serialized runner invocations.
  const stateKey = 'control-runner';
  let state = context.actions.get(stateKey) as State | undefined;
  if (!state) {
    state = { records: new Map(), generation: 0, closed: false };
    context.actions.set(stateKey, state);
    const owned = state;
    context.onDispose(() => { owned.closed = true; owned.generation++; owned.records.clear(); context.actions.delete(stateKey); });
  }
  const ledger = state;
  const error = (code: DiagnosticErrorCode, message: string): Output => ({ ok: false, error: { code, message } });
  const unknown = () => error('outcome-unknown', 'The action may have completed. Refresh to inspect the current state.');
  function rejection(value: unknown): ActionRejection | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<ActionRejection>;
    return item.kind === 'action-rejected' && typeof item.message === 'string'
      && ['stale-target', 'invalid-command', 'unsupported', 'cache-not-found'].includes(item.code ?? '')
      ? item as ActionRejection : null;
  }
  function validIntent(value: ActionIntent): boolean {
    if (!value || typeof value !== 'object') return false;
    switch (value.kind) {
      case 'delete-cache': return typeof value.cacheName === 'string';
      case 'delete-all-caches': return true;
      case 'delete-cache-entry': return typeof value.cacheName === 'string' && typeof value.requestKey === 'string';
      case 'update-worker': case 'unregister-worker': return typeof value.registrationId === 'string';
      case 'send-worker-message': return typeof value.sessionId === 'string' && typeof value.registrationId === 'string'
        && typeof value.workerId === 'string' && typeof value.jsonText === 'string'
        && (value.slot === 'active' || value.slot === 'waiting') && (value.reply === 'none' || value.reply === 'port');
      default: return false;
    }
  }
  function prune() {
    const now = Date.now();
    for (const [id, record] of ledger.records) {
      if ((record.phase === 'prepared' && record.ticket.expiresAt <= now)
        || (record.phase === 'complete' && record.completedAt! + 300_000 <= now)) ledger.records.delete(id);
    }
  }
  return async function run(command: ControlCommand): Promise<Output> {
    if (!command || (command.type !== 'prepare-action' && command.type !== 'commit-action')) return error('invalid-command', 'Unknown action command');
    if (ledger.closed || !command.expectedPage || !context.isCurrent(command.expectedPage)) return error('stale-target', 'The inspected document changed; refresh before acting');
    prune();
    if (command.type === 'prepare-action') {
      if ([...ledger.records.values()].some(record => record.phase === 'pending')) return error('action-busy', 'An action is still running');
      const generation = ++ledger.generation;
      for (const [id, record] of ledger.records) if (record.phase === 'prepared') ledger.records.delete(id);
      if (!validIntent(command.intent)) return error('invalid-command', 'Invalid action intent');
      const handler = handlers[command.intent.kind];
      if (!handler) return error('unsupported', 'This action is not supported');
      const page = Object.freeze({ ...command.expectedPage });
      const intent = Object.freeze({ ...command.intent });
      let prepared;
      try { prepared = await handler.prepare(intent); }
      catch (cause) {
        if (ledger.closed || !context.isCurrent(page)) return error('stale-target', 'The inspected document changed; refresh before acting');
        if (generation !== ledger.generation) return error('action-expired', 'A newer confirmation replaced this action');
        const safe = rejection(cause);
        return safe ? error(safe.code, safe.message) : error('evaluation-failed', 'Unable to prepare this action');
      }
      if (ledger.closed || !context.isCurrent(page)) return error('stale-target', 'The inspected document changed; refresh before acting');
      if (generation !== ledger.generation) return error('action-expired', 'A newer confirmation replaced this action');
      prune();
      while (ledger.records.size >= 100) {
        const oldest = [...ledger.records].find(([, record]) => record.phase === 'complete');
        if (!oldest) return error('action-busy', 'The action ledger is full');
        ledger.records.delete(oldest[0]);
      }
      const ticket: ActionTicket = { ticketId: crypto.randomUUID(), operationId: crypto.randomUUID(), page,
        expiresAt: Date.now() + 30_000, kind: intent.kind, summary: [...prepared.summary] };
      ledger.records.set(ticket.ticketId, { ticket, handler, retained: prepared.retained, phase: 'prepared' });
      // Never expose the retained internal ticket to a direct caller.
      return { ok: true, value: { ...ticket, page: { ...page }, summary: [...ticket.summary] } };
    }
    if (typeof command.ticketId !== 'string') return error('invalid-command', 'Invalid action ticket');
    const record = ledger.records.get(command.ticketId);
    if (!record) return error('action-expired', 'This confirmation expired; prepare the action again');
    if (!context.isCurrent(record.ticket.page)) return error('stale-target', 'The inspected document changed; refresh before acting');
    if (record.phase === 'complete') return record.result!;
    if ([...ledger.records.values()].some(item => item.phase === 'pending')) return error('action-busy', 'An action is still running');
    record.phase = 'pending'; // Consume and acquire the lock before the first await.
    let result: Output;
    try {
      const items = await record.handler.execute(record.retained, () => !ledger.closed && context.isCurrent(record.ticket.page));
      result = ledger.closed || !context.isCurrent(record.ticket.page) ? unknown() : { ok: true, value: {
        operationId: record.ticket.operationId, kind: record.ticket.kind,
        status: items.some(item => item.outcome === 'failed' || item.outcome === 'skipped') ? 'partial' : 'completed', items,
      } };
    } catch (cause) {
      const safe = rejection(cause);
      result = ledger.closed || !context.isCurrent(record.ticket.page) || !safe ? unknown() : error(safe.code, safe.message);
    }
    if (!ledger.closed) { record.phase = 'complete'; record.completedAt = Date.now(); record.result = result; }
    return result;
  };
}
