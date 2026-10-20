export function createTransport() {
    return { invalidate() { }, async invoke(command) {
            window.a4calls ??= [];
            window.a4calls.push(command);
            const page = window.a4page ??= { documentId: 'fixture-document', origin: 'https://fixture.test', url: 'https://fixture.test/' + 'long-path/'.repeat(20) + '?exact=1#target' };
            if (command.type === 'page-context') {
                if (window.a4holdContext)
                    await new Promise(resolve => { window.a4releaseContext = resolve; });
                return { ok: true, value: { ...page } };
            }
            if (command.type === 'overview') {
                if (window.a4refreshError)
                    return { ok: false, error: { code: 'evaluation-failed', message: 'Fixture refresh failed' } };
                return { ok: true, value: { page: { ...page }, origin: page.origin, registrations: [], controller: null, caches: [{ name: 'assets', entries: 0, partial: false }], storage: { usageBytes: null, quotaBytes: null }, warnings: [] } };
            }
            if (command.type === 'prepare-action')
                return { ok: true, value: { ticketId: 'ticket', operationId: 'operation', kind: command.intent.kind, page: { ...page }, expiresAt: Date.now() + 30000, summary: ['Delete cache assets with a very long name: ' + 'namespace/'.repeat(30)] } };
            if (command.type === 'commit-action') {
                await new Promise(resolve => { window.a4finish = resolve; });
                if (window.a4unknown)
                    return { ok: false, error: { code: 'outcome-unknown', message: 'The action may have completed. Refresh to inspect the current state.' } };
                return { ok: true, value: { operationId: 'operation', kind: 'delete-cache', status: window.a4receiptStatus ?? 'completed', items: window.a4receiptItems ?? [{ target: 'assets', outcome: 'applied' }] } };
            }
            if (command.type === 'list-cache-keys')
                return { ok: true, value: { cacheName: 'assets', snapshotId: 'snapshot', entries: [], totalEntries: 0, partial: false } };
            return { ok: true, value: [] };
        } };
}
