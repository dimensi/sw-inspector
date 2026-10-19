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
