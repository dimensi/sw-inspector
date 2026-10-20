import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlRunner } from '../../src/actions/page-runner';
import type { PageContext } from '../../src/bridge/page-context';
import type { ActionHandlers, ActionTicket } from '../../src/domain/actions';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture(handlers?: ActionHandlers) {
  let page = { documentId: 'doc', origin: 'https://a.test', url: 'https://a.test/' };
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const context: PageContext = { identity: () => ({ ...page }), isCurrent: p => !disposed && JSON.stringify(p) === JSON.stringify(page), replaceRegistrationCleanup: () => {}, onDispose: f => cleanups.push(f), actions: new Map(), registrations: new Map(), manifests: new Map(), messages: new Map() };
  const prepare = vi.fn(async () => ({ summary: ['Delete cache'], retained: { name: 'cache' } }));
  const execute = vi.fn(async () => [{ target: 'cache', outcome: 'applied' as const }]);
  const run = createControlRunner(context, handlers ?? { 'delete-cache': { prepare, execute } });
  const prep = () => run({ type: 'prepare-action', expectedPage: { ...page }, intent: { kind: 'delete-cache', cacheName: 'cache' } });
  const commit = (t: ActionTicket) => run({ type: 'commit-action', expectedPage: { ...t.page }, ticketId: t.ticketId });
  const ticket = async () => {
    const r = await prep();
    if (!r.ok || !('ticketId' in r.value))
      throw Error('no ticket');
    return r.value;
  };
  return { context, run, prep, commit, ticket, prepare, execute, setPage: (p: typeof page) => {
      page = p;
    }, dispose: () => {
      disposed = true;
      context.actions.clear();
      cleanups.forEach(f => f());
    } };
}
afterEach(() => vi.useRealTimers());
describe('control runner', () => {
  it('failed newer prepare invalidates old ticket and in-flight prepare', async () => {
    const f = fixture();
    const old = await f.ticket();
    expect(await f.run({ type: 'prepare-action', expectedPage: f.context.identity(), intent: { kind: 'delete-all-caches' } })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(await f.commit(old)).toMatchObject({ ok: false, error: { code: 'action-expired' } });
    const gate = deferred<{summary:string[];retained:unknown}>();
    const g = fixture({ 'delete-cache': { prepare: () => gate.promise, execute: async () => [] } });
    const late = g.prep();
    await g.run({ type: 'prepare-action', expectedPage: g.context.identity(), intent: {kind:'delete-all-caches'} });
    gate.resolve({summary:[],retained:null});
    expect(await late).toMatchObject({ ok:false, error:{code:'action-expired'} });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('runner instances share tickets and pending locks', async () => {
    const wait = deferred<[
    ]>();
    const handlers: ActionHandlers = { 'delete-cache': { prepare: async () => ({ summary: ['summary'], retained: null }), execute: () => wait.promise } };
    const f = fixture(handlers);
    const t = await f.ticket();
    const other = createControlRunner(f.context, handlers);
    const pending = other({ type: 'commit-action', expectedPage: t.page, ticketId: t.ticketId });
    expect(await f.commit(t)).toMatchObject({ ok: false, error: { code: 'action-busy' } });
    expect(await f.prep()).toMatchObject({ ok: false, error: { code: 'action-busy' } });
    wait.resolve([]);
    const result = await pending;
    expect(await f.commit(t)).toEqual(result);
  });
  it('caller cannot mutate retained ticket identity or summary', async () => {
    const f = fixture();
    const t = await f.ticket();
    t.summary.push('modified');
    t.page.url = 'changed';
    expect(await f.run({ type: 'commit-action', expectedPage: f.context.identity(), ticketId: t.ticketId })).toMatchObject({ ok: true });
  });
  it('prepare_has_zero_effects and commit_executes_once', async () => {
    const f = fixture();
    const t = await f.ticket();
    expect(f.prepare).toHaveBeenCalledOnce();
    expect(f.execute).not.toHaveBeenCalled();
    const r = await f.commit(t);
    expect(r.ok).toBe(true);
    expect(await f.commit(t)).toEqual(r);
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it('unsupported_kind_is_rejected and malformed supported intent is rejected', async () => {
    const f = fixture({});
    expect(await f.prep()).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    const g = fixture();
    expect(await g.run({ type: 'prepare-action', expectedPage: g.context.identity(), intent: { kind: 'delete-cache' } as never })).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
  });
  it('expired_or_changed_page_never_executes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let t = await f.ticket();
    await vi.advanceTimersByTimeAsync(30000);
    expect(await f.commit(t)).toMatchObject({ ok: false, error: { code: 'action-expired' } });
    t = await f.ticket();
    await f.ticket();
    expect(await f.commit(t)).toMatchObject({ ok: false, error: { code: 'action-expired' } });
    for (const key of ['documentId', 'origin', 'url'] as const) {
      const g = fixture();
      const old = await g.ticket();
      g.setPage({ ...old.page, [key]: 'changed' });
      expect(await g.commit(old)).toMatchObject({ ok: false, error: { code: 'stale-target' } });
      expect(g.execute).not.toHaveBeenCalled();
    }
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('duplicate_pending_is_busy and duplicate complete returns receipt', async () => {
    const pending = deferred<{
      target: string;
      outcome: 'applied';
    }[]>();
    const execute = vi.fn(() => pending.promise);
    const f = fixture({ 'delete-cache': { prepare: async () => ({ summary: [], retained: null }), execute } });
    const t = await f.ticket();
    const first = f.commit(t);
    expect(await f.commit(t)).toMatchObject({ ok: false, error: { code: 'action-busy' } });
    expect(await f.prep()).toMatchObject({ ok: false, error: { code: 'action-busy' } });
    expect(execute).toHaveBeenCalledOnce();
    pending.resolve([{ target: 'a', outcome: 'applied' }]);
    const result = await first;
    expect(await f.commit(t)).toEqual(result);
  });
  it('prepare races retain latest intent and frozen page', async () => {
    const a = deferred<{
      summary: string[];
      retained: unknown;
    }>();
    const b = deferred<{
      summary: string[];
      retained: unknown;
    }>();
    const execute = vi.fn(async (_retained: unknown) => []);
    const prepare = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const f = fixture({ 'delete-cache': { prepare, execute } });
    const intent = { kind: 'delete-cache' as const, cacheName: 'original' };
    const page = f.context.identity();
    const first = f.run({ type: 'prepare-action', expectedPage: page, intent });
    intent.cacheName = 'mutated';
    page.url = 'changed';
    const second = f.prep();
    a.resolve({ summary: ['old'], retained: 'old' });
    expect(await first).toMatchObject({ ok: false, error: { code: 'action-expired' } });
    b.resolve({ summary: ['new'], retained: 'new' });
    const r = await second;
    expect(prepare.mock.calls[0][0].cacheName).toBe('original');
    expect(r.ok).toBe(true);
    if (r.ok && 'ticketId' in r.value) {
      await f.commit(r.value);
      expect(execute.mock.calls[0][0]).toBe('new');
    }
  });
  it('dispose rejects late prepare and execute without repopulating ledger', async () => {
    const p = deferred<{
      summary: string[];
      retained: unknown;
    }>();
    const f = fixture({ 'delete-cache': { prepare: () => p.promise, execute: async () => [] } });
    const result = f.prep();
    f.dispose();
    p.resolve({ summary: [], retained: null });
    expect(await result).toMatchObject({ ok: false, error: { code: 'stale-target' } });
    expect(f.context.actions.size).toBe(0);
    const e = deferred<[
    ]>();
    const g = fixture({ 'delete-cache': { prepare: async () => ({ summary: [], retained: null }), execute: () => e.promise } });
    const running = g.commit(await g.ticket());
    g.dispose();
    e.resolve([]);
    expect(await running).toMatchObject({ ok: false, error: { code: 'outcome-unknown' } });
    expect(g.context.actions.size).toBe(0);
  });
  it('typed rejection allowlist and unexpected execute exceptions', async () => {
    for (const [error, code] of [[{ kind: 'action-rejected', code: 'cache-not-found', message: 'gone' }, 'cache-not-found'], [{ kind: 'action-rejected', code: 'timeout', message: 'fake' }, 'outcome-unknown'], [Error('boom'), 'outcome-unknown']] as const) {
      const f = fixture({ 'delete-cache': { prepare: async () => ({ summary: [], retained: null }), execute: async () => {
            throw error;
          } } });
      const t = await f.ticket();
      const result = await f.commit(t);
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(await f.commit(t)).toEqual(result);
    }
  });
  it('partial receipt preserves applied, failed and skipped items', async () => {
    const items = [{ target: 'a', outcome: 'applied' as const }, { target: 'b', outcome: 'failed' as const }, { target: 'c', outcome: 'skipped' as const }];
    const f = fixture({ 'delete-cache': { prepare: async () => ({ summary: [], retained: null }), execute: async () => items } });
    expect(await f.commit(await f.ticket())).toMatchObject({ ok: true, value: { status: 'partial', items } });
  });
  it('callback checks frozen page after awaits', async () => {
    const gate = deferred<null>();
    let current!: () => boolean;
    const f = fixture({ 'delete-cache': { prepare: async () => ({ summary: [], retained: null }), execute: async (_, check) => {
          current = check;
          await gate.promise;
          return [{ target: 'a', outcome: check() ? 'applied' : 'skipped' }];
        } } });
    const t = await f.ticket();
    const result = f.commit(t);
    expect(current()).toBe(true);
    f.setPage({ ...t.page, url: 'changed' });
    expect(current()).toBe(false);
    gate.resolve(null);
    expect(await result).toMatchObject({ ok: false, error: { code: 'outcome-unknown' } });
  });
  it('pending ledger entry survives TTL and capacity cleanup', async () => {
    vi.useFakeTimers();
    const gate = deferred<[]>();
    let block = false;
    const execute = vi.fn(async () => block ? gate.promise : []);
    const f = fixture({ 'delete-cache': { prepare: async () => ({ summary: [], retained: null }), execute } });
    for (let i = 0; i < 100; i++) await f.commit(await f.ticket());
    block = true;
    const t = await f.ticket();
    const pending = f.commit(t);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(await f.prep()).toMatchObject({ ok: false, error: { code: 'action-busy' } });
    expect(await f.commit(t)).toMatchObject({ ok: false, error: { code: 'action-busy' } });
    gate.resolve([]);
    expect(await pending).toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledTimes(101);
    f.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ledger_is_bounded and expires completed records', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const records = () => (f.context.actions.get('control-runner') as {
      records: Map<string, unknown>;
    }).records;
    const old = await f.ticket();
    await f.commit(old);
    for (let i = 0; i < 110; i++)
      await f.commit(await f.ticket());
    expect(records().size).toBe(100);
    await vi.advanceTimersByTimeAsync(300000);
    await f.ticket();
    expect(records().size).toBe(1);
    expect(await f.commit(old)).toMatchObject({ ok: false, error: { code: 'action-expired' } });
    f.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
