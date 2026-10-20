import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createTransport, type EvalFn } from '../../src/bridge/transport';

const success = { ok: true, value: { origin: 'https://example.test' } } as const;

async function acknowledgedJob(source: string): Promise<[string, undefined]> {
  const match = source.match(/const id = ("(?:[^"\\]|\\.)*");/);
  if (!match) throw new Error(`Missing job id in: ${source}`);
  return [JSON.stringify({ jobId: JSON.parse(match[1]) }), undefined];
}

function completed(result: unknown): [string, undefined] {
  return [JSON.stringify({ state: 'complete', result }), undefined];
}

describe('diagnostic transport', () => {
  it('starts an inspected-page job synchronously and polls its completed JSON result', async () => {
    const evaluate = vi.fn()
      .mockImplementationOnce(acknowledgedJob)
      .mockResolvedValueOnce(completed(success));
    const result = await createTransport(evaluate, { pollIntervalMs: 0 }).invoke({ type: 'overview' });
    expect(result).toEqual(success);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[0][0]).toContain('Promise.resolve().then');
    expect(evaluate.mock.calls[1][0]).toContain('state: \'pending\'');
  });

  it('maps page exceptions without throwing into the panel', async () => {
    const evaluate: EvalFn = vi.fn().mockResolvedValue([undefined, { isException: true, value: 'Denied' }]);
    await expect(createTransport(evaluate).invoke({ type: 'overview' })).resolves.toEqual({
      ok: false,
      error: { code: 'evaluation-failed', message: 'Denied' },
    });
  });

  it('maps rejected evaluation promises', async () => {
    const evaluate: EvalFn = vi.fn().mockRejectedValue(new Error('Safari denied access'));
    await expect(createTransport(evaluate).invoke({ type: 'overview' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'evaluation-failed', message: 'Safari denied access' },
    });
  });

  it('rejects malformed completed job replies', async () => {
    const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob).mockResolvedValueOnce(completed({ unexpected: true }));
    await expect(createTransport(evaluate, { pollIntervalMs: 0 }).invoke({ type: 'overview' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'malformed-result' },
    });
  });

  it('discards a result when navigation invalidates the request', async () => {
    let complete!: (value: [string, undefined]) => void;
    const evaluate = vi.fn()
      .mockImplementationOnce(acknowledgedJob)
      .mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const transport = createTransport(evaluate, { pollIntervalMs: 0 });
    const pending = transport.invoke({ type: 'overview' });
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
    transport.invalidate();
    complete(completed(success));
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'stale-result' } });
  });

  it('discards a result if the inspected origin changes', async () => {
    let origin = 'https://one.test';
    const evaluate = vi.fn()
      .mockImplementationOnce(acknowledgedJob)
      .mockImplementationOnce(async () => {
        origin = 'https://two.test';
        return completed(success);
      });
    await expect(createTransport(evaluate, { getOrigin: () => origin, pollIntervalMs: 0 }).invoke({ type: 'overview' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale-result' },
    });
  });

  it('stops polling when aborted', async () => {
    const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob).mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = createTransport(evaluate, { pollIntervalMs: 0 }).invoke({ type: 'overview' }, { signal: controller.signal });
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } });
  });

  it('times out a stalled page poll', async () => {
    vi.useFakeTimers();
    const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob).mockImplementationOnce(() => new Promise(() => {}));
    const pending = createTransport(evaluate, { timeoutMs: 20, pollIntervalMs: 0 }).invoke({ type: 'overview' });
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
    vi.useRealTimers();
  });

  it('times out a stalled origin read before a job begins', async () => {
    vi.useFakeTimers();
    const evaluate: EvalFn = vi.fn().mockResolvedValue(completed(success));
    const pending = createTransport(evaluate, { getOrigin: () => new Promise<string>(() => {}), timeoutMs: 20 }).invoke({ type: 'overview' });
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(evaluate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

const page = { documentId: 'document', origin: 'https://example.test', url: 'https://example.test/' };
const commit = { type: 'commit-action', expectedPage: page, ticketId: 'ticket' } as const;
const receipt = { ok: true, value: { operationId: 'operation', kind: 'delete-cache', status: 'completed', items: [{ target: 'cache', outcome: 'applied' }] } };
const unknown = { ok: false, error: { code: 'outcome-unknown', message: 'The action may have completed. Refresh to inspect the current state.' } };

describe('control transport outcomes', () => {
  it.each(['lost ack', 'evaluation exception', 'malformed ack', 'failed poll', 'missing poll', 'malformed receipt', 'malformed error'])('commit %s is unknown without resubmission', async (scenario) => {
    const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob);
    if (scenario === 'lost ack') evaluate.mockReset().mockRejectedValueOnce(new Error('disconnected'));
    else if (scenario === 'evaluation exception') evaluate.mockReset().mockResolvedValueOnce([undefined, { isException: true }]);
    else if (scenario === 'malformed ack') evaluate.mockReset().mockResolvedValueOnce(['{}', undefined]);
    else if (scenario === 'failed poll') evaluate.mockResolvedValueOnce([JSON.stringify({ state: 'failed', error: 'failed' }), undefined]);
    else if (scenario === 'missing poll') evaluate.mockResolvedValueOnce([JSON.stringify({ state: 'missing' }), undefined]);
    else if (scenario === 'malformed receipt') evaluate.mockResolvedValueOnce(completed({ ok: true, value: { ...receipt.value, items: [{ target: 'cache', outcome: 'invented' }] } }));
    else evaluate.mockResolvedValueOnce(completed({ ok: false, error: { code: 'action-expired', message: 42 } }));
    await expect(createTransport(evaluate, { pollIntervalMs: 0 }).invoke(commit)).resolves.toEqual(unknown);
    expect(evaluate.mock.calls.filter(([source]) => source.includes('const id = '))).toHaveLength(1);
  });

  it('commit timeout after start is unknown but prepare timeout is ordinary', async () => {
    vi.useFakeTimers();
    try {
      for (const command of [commit, { type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-all-caches' } } as const]) {
        const evaluate = vi.fn().mockImplementation(() => new Promise(() => {}));
        const pending = createTransport(evaluate, { timeoutMs: 20 }).invoke(command);
        await vi.advanceTimersByTimeAsync(20);
        expect(await pending).toMatchObject({ ok: false, error: { code: command.type === 'commit-action' ? 'outcome-unknown' : 'timeout' } });
        expect(evaluate).toHaveBeenCalledTimes(1);
      }
    } finally { vi.useRealTimers(); }
  });

  it('pre-aborted commit does not evaluate; abort after submission is unknown', async () => {
    const controller = new AbortController();
    controller.abort();
    const evaluate = vi.fn().mockImplementation(() => new Promise(() => {}));
    const transport = createTransport(evaluate);
    await expect(transport.invoke(commit, { signal: controller.signal })).resolves.toMatchObject({ error: { code: 'aborted' } });
    expect(evaluate).not.toHaveBeenCalled();
    const active = new AbortController();
    const pending = transport.invoke(commit, { signal: active.signal });
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
    active.abort();
    await expect(pending).resolves.toEqual(unknown);
  });

  it.each(['stale-target', 'action-expired', 'action-busy', 'invalid-command', 'unsupported', 'cache-not-found'])('preserves validated pre-effect %s rejection', async (code) => {
    const rejection = { ok: false, error: { code, message: 'Rejected before effect' } };
    const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob).mockResolvedValueOnce(completed(rejection));
    await expect(createTransport(evaluate, { pollIntervalMs: 0 }).invoke(commit)).resolves.toEqual(rejection);
  });

  it('validates receipts and suppresses completed receipt after page invalidation', async () => {
    const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob).mockResolvedValueOnce(completed(receipt)).mockResolvedValueOnce([JSON.stringify(page), undefined]);
    await expect(createTransport(evaluate, { pollIntervalMs: 0 }).invoke(commit)).resolves.toEqual(receipt);
    const changed = vi.fn().mockImplementationOnce(acknowledgedJob).mockImplementationOnce(async () => {
      transport.invalidate();
      return completed(receipt);
    });
    const transport = createTransport(changed, { pollIntervalMs: 0 });
    await expect(transport.invoke(commit)).resolves.toEqual(unknown);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

it('suppresses a receipt after same-URL reload without a navigation notification', async () => {
  const createRealm = () => {
    const events = new EventTarget();
    const counters = { effects: 0 };
    return Object.assign(counters, { crypto, navigator: {}, location: { origin: page.origin, href: page.url }, setTimeout: () => 0,
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      caches: { keys: async () => ['cache'], delete: async () => { counters.effects++; return true; } } });
  };
  const original = createRealm();
  let realm = original;
  let starts = 0;
  const evaluate: EvalFn = async source => {
    if (source.includes('const id = ')) starts++;
    const raw = runInNewContext(source, realm);
    const reply = JSON.parse(raw);
    if (reply.state === 'complete' && reply.result?.value?.status === 'completed') realm = createRealm();
    return [raw, undefined];
  };
  const transport = createTransport(evaluate, { pollIntervalMs: 0, getOrigin: () => page.origin });
  const identity = await transport.invoke<typeof page>({ type: 'page-context' });
  if (!identity.ok) throw new Error('Missing fixture identity');
  const prepared = await transport.invoke<{ ticketId: string }>({ type: 'prepare-action', expectedPage: identity.value, intent: { kind: 'delete-cache', cacheName: 'cache' } });
  if (!prepared.ok) throw new Error('Missing fixture ticket');
  await expect(transport.invoke({ type: 'commit-action', expectedPage: identity.value, ticketId: prepared.value.ticketId })).resolves.toEqual(unknown);
  expect(original.effects).toBe(1);
  expect(realm.effects).toBe(0);
  expect(starts).toBe(3); // context, prepare, commit; no retry or new ticket.
});

it('rejects malformed prepare tickets and preserves a typed prepare failure', async () => {
  for (const result of [
    { ok: true, value: { ticketId: 'ticket', operationId: 'operation', kind: 'delete-all-caches', expiresAt: 42, page: { ...page, documentId: 'other' }, summary: [] } },
    { ok: false, error: { code: ['unsupported'], message: 'invalid code' } },
  ]) {
    const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob).mockResolvedValueOnce(completed(result));
    await expect(createTransport(evaluate, { pollIntervalMs: 0 }).invoke({ type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-all-caches' } })).resolves.toMatchObject({ error: { code: 'malformed-result' } });
  }
  const result = { ok: false, error: { code: 'evaluation-failed', message: 'Unable to prepare this action' } };
  const evaluate = vi.fn().mockImplementationOnce(acknowledgedJob).mockResolvedValueOnce(completed(result));
  await expect(createTransport(evaluate, { pollIntervalMs: 0 }).invoke({ type: 'prepare-action', expectedPage: page, intent: { kind: 'delete-all-caches' } })).resolves.toEqual(result);
});


it.each(['lost ack', 'malformed ack', 'missing poll', 'malformed receipt', 'timeout'] as const)('worker commit %s stays unknown after one real unregister', async fault => {
  const events = new EventTarget();
  const unregister = vi.fn(async () => true);
  const registration = { scope: 'https://example.test/worker/', installing: null, waiting: null, active: null, unregister };
  const realm = { crypto, navigator: { serviceWorker: { controller: null, getRegistrations: async () => [registration] } },
    location: { origin: page.origin, href: page.url }, setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  let corrupt = false;
  let commitStarts = 0;
  const evaluate: EvalFn = async source => {
    const raw = runInNewContext(source, realm);
    if (corrupt) {
      if (source.includes('const id = ')) {
        commitStarts++;
        await new Promise(resolve => setImmediate(resolve));
        if (fault === 'lost ack') throw new Error('Disconnected after dispatch');
        if (fault === 'malformed ack') return ['{}', undefined];
      } else {
        if (fault === 'timeout') return new Promise(() => {});
        if (fault === 'missing poll') return [JSON.stringify({ state: 'missing' }), undefined];
        return completed({ ok: true, value: { invalid: true } });
      }
    }
    return [raw, undefined];
  };
  const transport = createTransport(evaluate, { pollIntervalMs: 0, timeoutMs: 100, getOrigin: () => page.origin });
  const overview = await transport.invoke<import('../../src/domain/types').Overview>({ type: 'overview' });
  if (!overview.ok) throw new Error('Missing overview');
  const expectedPage = overview.value.page;
  const prepared = await transport.invoke<{ ticketId: string }>({ type: 'prepare-action', expectedPage,
    intent: { kind: 'unregister-worker', registrationId: overview.value.registrations[0].registrationId! } });
  if (!prepared.ok) throw new Error('Missing worker ticket');
  corrupt = true;
  await expect(transport.invoke({ type: 'commit-action', expectedPage, ticketId: prepared.value.ticketId })).resolves.toEqual(unknown);
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(commitStarts).toBe(1);
});
