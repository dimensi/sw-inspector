import { afterEach, describe, expect, it, vi } from 'vitest';
import { createControlRunner } from '../../src/actions/page-runner';
import { createPageContext } from '../../src/bridge/page-context';
import { createPageRunner } from '../../src/diagnostics/page-runner';
import { createWorkerActions } from '../../src/workers/page-actions';
import type { Overview, Result } from '../../src/domain/types';

function registration(scope: string) {
  return { scope, installing: null, waiting: null,
    active: { scriptURL: 'https://app.test/sw.js', state: 'activated' },
    update: vi.fn(), unregister: vi.fn() };
}
async function setup() {
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('location', { origin: 'https://app.test', href: 'https://app.test/page' });
  const found = [registration('https://app.test/first/'), registration('https://app.test/second/')];
  const getRegistrations = vi.fn(async () => found);
  vi.stubGlobal('navigator', { serviceWorker: { controller: null, getRegistrations,
    get ready() { throw new Error('must not await ready'); } } });
  vi.stubGlobal('caches', { keys: async () => [] });
  const context = createPageContext(`workers-${crypto.randomUUID()}`);
  const result = await createPageRunner(undefined, context)({ type: 'overview' }) as Result<Overview>;
  if (!result.ok) throw new Error(result.error.message);
  const id = result.value.registrations[1].registrationId!;
  const handlers = createWorkerActions(context);
  return { found, context, id, handlers, getRegistrations };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('worker preparation', () => {
  it.each(['update-worker', 'unregister-worker'] as const)('prepare retains selected registration without effects for %s', async kind => {
    const { found, id, handlers } = await setup();
    const prepared = await handlers[kind]!.prepare({ kind, registrationId: id });
    expect(prepared.retained).toMatchObject({ registrationId: id, registration: found[1] });
    expect(prepared.summary).toContain(found[1].scope);
    expect(prepared.summary).toContain('https://app.test/page');
    expect(prepared.summary).toContain(kind === 'update-worker'
      ? 'This may download and install a new worker. Activation is not guaranteed.'
      : 'Existing pages may remain controlled. Cache Storage is unchanged.');
    for (const row of found) { expect(row.update).not.toHaveBeenCalled(); expect(row.unregister).not.toHaveBeenCalled(); }
  });

  it.each(['missing', 'expired', 'registration', 'active', 'waiting'] as const)('rejects %s target without effects', async replacement => {
    const { found, context, id, handlers } = await setup();
    let target = id;
    if (replacement === 'missing') target = 'unknown';
    if (replacement === 'expired') context.registrations.get(id)!.expiresAt = Date.now();
    if (replacement === 'registration') found[1] = registration(found[1].scope);
    if (replacement === 'active') found[1].active = { ...found[1].active };
    if (replacement === 'waiting') Object.assign(found[1], { waiting: { ...found[1].active } });
    await expect(handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: target }))
      .rejects.toMatchObject({ kind: 'action-rejected', code: 'stale-target' });
    for (const row of found) { expect(row.update).not.toHaveBeenCalled(); expect(row.unregister).not.toHaveBeenCalled(); }
  });

  it.each(['navigation', 'expiry', 'refresh'] as const)('rechecks %s after collection await', async change => {
    const { context, found, id, handlers, getRegistrations } = await setup();
    getRegistrations.mockImplementationOnce(async () => {
      if (change === 'navigation') location.href += '?new';
      if (change === 'expiry') context.registrations.get(id)!.expiresAt = Date.now();
      if (change === 'refresh') context.registrations.clear();
      return found;
    });
    await expect(handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id }))
      .rejects.toMatchObject({ code: 'stale-target' });
    expect(found[1].update).not.toHaveBeenCalled();
  });

  it('rejects overview handles from a previous SPA URL through the control runner', async () => {
    const { context, id, handlers, found } = await setup();
    location.href += '?new';
    const run = createControlRunner(context, handlers);
    await expect(run({ type: 'prepare-action', expectedPage: context.identity(),
      intent: { kind: 'update-worker', registrationId: id } })).resolves.toMatchObject({ ok: false, error: { code: 'stale-target' } });
    for (const row of found) { expect(row.update).not.toHaveBeenCalled(); expect(row.unregister).not.toHaveBeenCalled(); }
  });

  it('does not treat getRegistrations failure as absence', async () => {
    const { id, handlers, getRegistrations } = await setup();
    getRegistrations.mockRejectedValueOnce(new Error('denied'));
    await expect(handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id })).rejects.toThrow('denied');
  });

  it('does not wait for ready', async () => {
    const { id, handlers } = await setup();
    await expect(handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id })).resolves.toHaveProperty('retained');
  });
});


describe('worker update', () => {
  it('calls only the retained registration once without implying activation', async () => {
    const { handlers, id, found } = await setup();
    const active = found[1].active;
    const prepared = await handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id });
    const result = await handlers['update-worker']!.execute(prepared.retained, () => true);
    expect(found[1].update).toHaveBeenCalledTimes(1);
    expect(found[0].update).not.toHaveBeenCalled();
    for (const row of found) expect(row.unregister).not.toHaveBeenCalled();
    expect(found[1].active).toBe(active);
    expect(found[1].waiting).toBeNull();
    expect(navigator.serviceWorker.controller).toBeNull();
    expect(result).toEqual([{ target: found[1].scope, outcome: 'applied', message: 'Update check completed. Activation is not guaranteed.' }]);
  });

  it.each(['registration', 'installing', 'waiting', 'active', 'expiry', 'current', 'navigation', 'refresh'] as const)('revalidates %s before native update', async change => {
    const { handlers, id, found, context } = await setup();
    const selected = found[1];
    const prepared = await handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id });
    if (change === 'registration') found[1] = registration(selected.scope);
    if (['installing', 'waiting', 'active'].includes(change)) Object.assign(selected, { [change]: { ...selected.active } });
    if (change === 'expiry') vi.setSystemTime(Date.now() + 300000);
    if (change === 'navigation') location.href += '?new';
    if (change === 'refresh') context.registrations.clear();
    await expect(handlers['update-worker']!.execute(prepared.retained, () => change !== 'current'))
      .rejects.toMatchObject({ kind: 'action-rejected', code: 'stale-target' });
    expect(selected.update).not.toHaveBeenCalled();
    expect(found[1].update).not.toHaveBeenCalled();
  });

  it.each(['slot', 'expiry', 'navigation', 'current'] as const)('rechecks %s after execute collection await', async change => {
    const { handlers, id, found, getRegistrations } = await setup();
    const prepared = await handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id });
    let current = true;
    getRegistrations.mockImplementationOnce(async () => {
      if (change === 'slot') found[1].active = { ...found[1].active };
      if (change === 'expiry') vi.setSystemTime(Date.now() + 300000);
      if (change === 'navigation') location.href += '?new';
      if (change === 'current') current = false;
      return found;
    });
    await expect(handlers['update-worker']!.execute(prepared.retained, () => current)).rejects.toMatchObject({ code: 'stale-target' });
    expect(found[1].update).not.toHaveBeenCalled();
  });

  it('reports a rejected native update locally and preserves overview handles', async () => {
    const { handlers, id, found, context } = await setup();
    const prepared = await handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id });
    found[1].update.mockRejectedValueOnce(new DOMException('blocked <script>', 'SecurityError'));
    await expect(handlers['update-worker']!.execute(prepared.retained, () => true)).resolves.toEqual([
      { target: found[1].scope, outcome: 'failed', message: 'blocked <script>' },
    ]);
    expect(context.registrations.has(id)).toBe(true);
    expect(found[1].update).toHaveBeenCalledTimes(1);
  });

  it('does not reinterpret late navigation as a pre-effect rejection or retry', async () => {
    const { handlers, id, found } = await setup();
    const prepared = await handlers['update-worker']!.prepare({ kind: 'update-worker', registrationId: id });
    found[1].update.mockImplementationOnce(async () => { location.href += '?new'; });
    await expect(handlers['update-worker']!.execute(prepared.retained, () => true)).resolves.toMatchObject([{ outcome: 'applied' }]);
    expect(found[1].update).toHaveBeenCalledTimes(1);
  });


});


describe('worker unregister', () => {
  it.each([true, false])('unregister %s preserves controller and Cache Storage', async result => {
    const { handlers, id, found } = await setup();
    const controller = found[1].active;
    Object.assign(navigator.serviceWorker, { controller });
    const deleteCache = vi.fn();
    Object.assign(caches, { delete: deleteCache });
    const reload = vi.fn();
    Object.assign(location, { reload });
    found[1].unregister.mockResolvedValueOnce(result);
    const prepared = await handlers['unregister-worker']!.prepare({ kind: 'unregister-worker', registrationId: id });
    await expect(handlers['unregister-worker']!.execute(prepared.retained, () => true)).resolves.toEqual([
      { target: found[1].scope, outcome: result ? 'applied' : 'absent', message: result
        ? 'Unregister request completed. Existing pages may remain controlled.' : 'Registration was not found.' },
    ]);
    expect(found[1].unregister).toHaveBeenCalledTimes(1);
    expect(found[0].unregister).not.toHaveBeenCalled();
    for (const row of found) expect(row.update).not.toHaveBeenCalled();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(navigator.serviceWorker.controller).toBe(controller);
  });

  it.each(['registration', 'installing', 'waiting', 'active', 'expiry', 'current', 'navigation', 'refresh'] as const)('rejects stale %s before unregister', async change => {
    const { handlers, id, found, context } = await setup();
    const selected = found[1];
    const prepared = await handlers['unregister-worker']!.prepare({ kind: 'unregister-worker', registrationId: id });
    if (change === 'registration') found[1] = registration(selected.scope);
    if (['installing', 'waiting', 'active'].includes(change)) Object.assign(selected, { [change]: { ...selected.active } });
    if (change === 'expiry') vi.setSystemTime(Date.now() + 300000);
    if (change === 'navigation') location.href += '?new';
    if (change === 'refresh') context.registrations.clear();
    await expect(handlers['unregister-worker']!.execute(prepared.retained, () => change !== 'current'))
      .rejects.toMatchObject({ kind: 'action-rejected', code: 'stale-target' });
    expect(selected.unregister).not.toHaveBeenCalled();
    expect(found[1].unregister).not.toHaveBeenCalled();
  });

  it('rejects replacement during collection await without unregistering either object', async () => {
    const { handlers, id, found, getRegistrations } = await setup();
    const selected = found[1];
    const prepared = await handlers['unregister-worker']!.prepare({ kind: 'unregister-worker', registrationId: id });
    getRegistrations.mockImplementationOnce(async () => { found[1] = registration(selected.scope); return found; });
    await expect(handlers['unregister-worker']!.execute(prepared.retained, () => true)).rejects.toMatchObject({ code: 'stale-target' });
    expect(selected.unregister).not.toHaveBeenCalled();
    expect(found[1].unregister).not.toHaveBeenCalled();
  });

  it('keeps native unregister rejection local', async () => {
    const { handlers, id, found } = await setup();
    const prepared = await handlers['unregister-worker']!.prepare({ kind: 'unregister-worker', registrationId: id });
    found[1].unregister.mockRejectedValueOnce(new DOMException('denied', 'SecurityError'));
    await expect(handlers['unregister-worker']!.execute(prepared.retained, () => true)).resolves.toEqual([
      { target: found[1].scope, outcome: 'failed', message: 'denied' },
    ]);
    expect(found[1].unregister).toHaveBeenCalledTimes(1);
  });
});
