import { describe, expect, it, vi } from 'vitest';
import { createActionController, type ActionState } from '../../src/ui/action-controller';
import type { ActionReceipt, ActionTicket, ControlCommand } from '../../src/domain/actions';
import type { PageIdentity, Result } from '../../src/domain/types';
const page: PageIdentity = { documentId: 'document-1', origin: 'https://app.test', url: 'https://app.test/path' };
const ticket = (): ActionTicket => ({ ticketId: 'ticket-1', operationId: 'operation-1', page: { ...page }, expiresAt: Date.now() + 30000, kind: 'delete-cache', summary: ['Delete cache assets'] });
const receipt: ActionReceipt = { operationId: 'operation-1', kind: 'delete-cache', status: 'completed', items: [{ target: 'assets', outcome: 'applied' }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
    let currentPage: PageIdentity | null = { ...page };
    let state: ActionState;
    const prepared = ticket();
    const invoke = vi.fn(async (command: ControlCommand): Promise<Result<unknown>> => ({ ok: true, value: command.type === 'prepare-action' ? prepared : receipt }));
    const settled = vi.fn(async (_receipt: ActionReceipt | null) => { });
    const controller = createActionController({ invoke: async <T>(command: ControlCommand) => await invoke(command) as Result<T>, getPage: () => currentPage, onState: value => { state = value; }, onSettled: settled });
    return { controller, invoke, settled, prepared, state: () => state, setPage: (value: PageIdentity | null) => { currentPage = value; } };
}
const intent = { kind: 'delete-cache', cacheName: 'assets' } as const;
describe('action controller', () => {
    it('direct_entry_prepares_and_commits_its_exact_ticket_without_confirming', async () => {
        const s = setup(); s.prepared.kind = 'delete-cache-entry';
        const phases: string[] = [];
        s.invoke.mockImplementation(async command => { phases.push(s.state().phase); return { ok: true, value: command.type === 'prepare-action' ? s.prepared : receipt }; });
        await s.controller.deleteEntry({ kind: 'delete-cache-entry', cacheName: 'assets', requestKey: 'snapshot:0' });
        expect(phases).toEqual(['preparing', 'running']);
        expect(s.invoke.mock.calls[1][0]).toEqual({ type: 'commit-action', expectedPage: page, ticketId: 'ticket-1' });
    });
    it('stale_direct_prepare_cannot_commit_a_newer_namespace_ticket', async () => {
        const s = setup(); const pending = deferred<Result<unknown>>(); s.invoke.mockImplementationOnce(() => pending.promise);
        const first = s.controller.deleteEntry({ kind: 'delete-cache-entry', cacheName: 'assets', requestKey: 'snapshot:0' });
        s.controller.reset(); await s.controller.prepare(intent);
        pending.resolve({ ok: true, value: { ...ticket(), kind: 'delete-cache-entry', ticketId: 'stale-entry' } }); await first;
        expect(s.state().phase).toBe('confirming'); expect(s.invoke).toHaveBeenCalledTimes(2);
        await s.controller.confirm(); expect(s.invoke.mock.calls[2][0]).toMatchObject({ ticketId: 'ticket-1' });
    });
    it.each(['reset', 'page-change', 'expiry', 'wrong-kind'])('direct_entry_%s_before_dispatch_never_commits', async reason => {
        const s = setup(); const pending = deferred<Result<unknown>>(); s.invoke.mockImplementationOnce(() => pending.promise);
        const first = s.controller.deleteEntry({ kind: 'delete-cache-entry', cacheName: 'assets', requestKey: 'snapshot:0' });
        if (reason === 'reset') s.controller.reset();
        if (reason === 'page-change') s.setPage({ ...page, documentId: 'new' });
        pending.resolve({ ok: true, value: { ...ticket(), kind: reason === 'wrong-kind' ? 'delete-cache' : 'delete-cache-entry', expiresAt: reason === 'expiry' ? Date.now() : Date.now() + 30000 } }); await first;
        expect(s.invoke).toHaveBeenCalledTimes(1);
    });
    it('direct_entry_double_click_prepares_and_commits_once', async () => {
        const s = setup(); s.prepared.kind = 'delete-cache-entry'; const pending = deferred<Result<unknown>>(); s.invoke.mockImplementationOnce(() => pending.promise);
        const entry = { kind: 'delete-cache-entry', cacheName: 'assets', requestKey: 'snapshot:0' } as const;
        const first = s.controller.deleteEntry(entry); await s.controller.deleteEntry(entry);
        expect(s.invoke).toHaveBeenCalledTimes(1); pending.resolve({ ok: true, value: s.prepared }); await first;
        expect(s.invoke).toHaveBeenCalledTimes(2);
    });
    it('cancel_never_commits', async () => { const s = setup(); await s.controller.prepare(intent); s.controller.cancel(); await s.controller.confirm(); expect(s.invoke).toHaveBeenCalledTimes(1); expect(s.state().phase).toBe('idle'); });
    it('confirm_uses_frozen_ticket', async () => { const s = setup(); await s.controller.prepare(intent); s.prepared.ticketId = 'changed'; s.prepared.page.url = 'https://other.test'; s.prepared.summary[0] = 'changed'; s.state().ticket!.ticketId = 'published-change'; await s.controller.confirm(); expect(s.invoke.mock.calls[1][0]).toEqual({ type: 'commit-action', ticketId: 'ticket-1', expectedPage: page }); });
    it('double_confirm_is_one_invoke', async () => { const s = setup(); const pending = deferred<Result<unknown>>(); await s.controller.prepare(intent); s.invoke.mockImplementationOnce(() => pending.promise); const first = s.controller.confirm(); await s.controller.confirm(); expect(s.invoke).toHaveBeenCalledTimes(2); pending.resolve({ ok: true, value: receipt }); await first; });
    it('reset_ignores_late_prepare', async () => { const s = setup(); const pending = deferred<Result<unknown>>(); s.invoke.mockImplementationOnce(() => pending.promise); const preparing = s.controller.prepare(intent); expect(s.state().phase).toBe('preparing'); s.controller.reset(); pending.resolve({ ok: true, value: ticket() }); await preparing; expect(s.state().phase).toBe('idle'); });
    it('settled_refresh_failure_does_not_hide_receipt', async () => { const s = setup(); s.settled.mockRejectedValueOnce(new Error('refresh denied')); await s.controller.prepare(intent); await s.controller.confirm(); expect(s.state().receipt).toEqual(receipt); expect(s.state().error).toBeNull(); expect(s.state().phase).toBe('result'); });
    it('reset_during_running_suppresses_late_commit_and_keeps_busy_guard', async () => { const s = setup(); const pending = deferred<Result<unknown>>(); await s.controller.prepare(intent); s.invoke.mockImplementationOnce(() => pending.promise); const running = s.controller.confirm(); s.controller.reset(); await s.controller.prepare(intent); expect(s.invoke).toHaveBeenCalledTimes(2); pending.resolve({ ok: true, value: receipt }); await running; expect(s.state().phase).toBe('idle'); expect(s.settled).not.toHaveBeenCalled(); await s.controller.prepare(intent); expect(s.state().phase).toBe('confirming'); });
    it('cancel_cannot_cancel_running', async () => { const s = setup(); const pending = deferred<Result<unknown>>(); await s.controller.prepare(intent); s.invoke.mockImplementationOnce(() => pending.promise); const running = s.controller.confirm(); s.controller.cancel(); expect(s.state().phase).toBe('running'); pending.resolve({ ok: true, value: receipt }); await running; expect(s.state().receipt).toEqual(receipt); });
    it('current_page_change_prevents_commit', async () => { const s = setup(); await s.controller.prepare(intent); s.setPage({ ...page, documentId: 'document-2' }); await s.controller.confirm(); expect(s.invoke).toHaveBeenCalledTimes(1); expect(s.state().error).toContain('changed'); });
    it('changed_page_suppresses_late_commit', async () => { const s = setup(); const pending = deferred<Result<unknown>>(); await s.controller.prepare(intent); s.invoke.mockImplementationOnce(() => pending.promise); const running = s.controller.confirm(); s.setPage({ ...page, documentId: 'document-2' }); pending.resolve({ ok: true, value: receipt }); await running; expect(s.settled).not.toHaveBeenCalled(); expect(s.state().receipt).toBeNull(); expect(s.state().phase).toBe('idle'); });
    it.each(['known', 'unknown'] as const)('worker %s settlement runs once and preserves its result during failed reread', async outcome => {
        const s = setup();
        s.prepared.kind = 'unregister-worker';
        const workerReceipt: ActionReceipt = { ...receipt, kind: 'unregister-worker', items: [{ target: 'https://app.test/worker/', outcome: 'applied', message: 'Unregister request completed. Existing pages may remain controlled.' }] };
        s.settled.mockRejectedValueOnce(new Error('snapshot failed'));
        await s.controller.prepare({ kind: 'unregister-worker', registrationId: 'selected-id' });
        s.invoke.mockResolvedValueOnce(outcome === 'known' ? { ok: true, value: workerReceipt } : { ok: false, error: { code: 'outcome-unknown', message: 'The action may have completed. Refresh to inspect the current state.' } });
        await s.controller.confirm();
        await s.controller.confirm();
        expect(s.invoke).toHaveBeenCalledTimes(2);
        expect(s.settled).toHaveBeenCalledExactlyOnceWith(outcome === 'known' ? workerReceipt : null);
        expect(s.state().receipt).toEqual(outcome === 'known' ? workerReceipt : null);
        expect(s.state().error).toBe(outcome === 'known' ? null : 'The action may have completed. Refresh to inspect the current state.');
    });
    it('no_page_disables_prepare', async () => { const s = setup(); s.setPage(null); await s.controller.prepare(intent); expect(s.invoke).not.toHaveBeenCalled(); expect(s.state().phase).toBe('idle'); });
    it('unknown_settles_with_null_and_preserves_action_error', async () => { const s = setup(); await s.controller.prepare(intent); s.invoke.mockResolvedValueOnce({ ok: false, error: { code: 'outcome-unknown', message: 'May have completed. Refresh.' } }); await s.controller.confirm(); expect(s.settled).toHaveBeenCalledWith(null); expect(s.state().error).toBe('May have completed. Refresh.'); });
});
