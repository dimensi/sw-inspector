import type { InspectorCommand } from '../domain/commands';
import { createJobPollExpression, createJobStartExpression } from './expressions';
import type { DiagnosticErrorCode, Result } from '../domain/types';

export type EvalException = {
  isException?: boolean;
  isError?: boolean;
  value?: string;
  code?: string;
};

export type EvalFn = (source: string) => Promise<[unknown, EvalException | undefined]>;

type InvokeOptions = {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

type TransportOptions = {
  getOrigin?: () => string | Promise<string>;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

type JobReply =
  | { state: 'pending' }
  | { state: 'complete'; result: unknown }
  | { state: 'failed'; error: string }
  | { state: 'missing' };

const failure = (code: DiagnosticErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});

function isResult(value: unknown): value is Result<unknown> {
  if (!value || typeof value !== 'object' || !('ok' in value)) return false;
  if (value.ok === true) return 'value' in value;
  return value.ok === false && 'error' in value;
}

function exceptionMessage(exception: EvalException): string {
  return exception.value ?? exception.code ?? 'Safari did not evaluate the inspected-page expression';
}

function waitFor<T>(operation: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const abort = () => reject(new Error('aborted'));
    signal?.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    });
  });
}

function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return waitFor(new Promise((resolve) => setTimeout(resolve, milliseconds)), signal, milliseconds + 1_000);
}

function jsonReply(raw: unknown): unknown {
  if (typeof raw !== 'string') throw new Error('Safari returned a non-JSON value from a synchronous DevTools expression');
  return JSON.parse(raw);
}

export function createTransport(evaluate: EvalFn, options: TransportOptions = {}) {
  let generation = 0;
  const getOrigin = options.getOrigin ?? (() => 'unknown-origin');
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;

  async function evaluateJson(source: string, signal: AbortSignal | undefined, remainingMs: () => number): Promise<unknown> {
    const [raw, exception] = await waitFor(evaluate(source), signal, remainingMs());
    if (exception?.isException || exception?.isError) throw new Error(exceptionMessage(exception));
    return jsonReply(raw);
  }

  return {
    invalidate() {
      generation += 1;
    },
    async invoke<T>(command: InspectorCommand, invokeOptions: InvokeOptions = {}): Promise<Result<T>> {
      if (invokeOptions.signal?.aborted) return failure('aborted', 'Inspection was cancelled') as Result<T>;

      const requestGeneration = generation;
      const deadline = Date.now() + timeoutMs;
      const remainingMs = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('timeout');
        return remaining;
      };

      try {
        const requestOrigin = await waitFor(Promise.resolve().then(getOrigin), invokeOptions.signal, remainingMs());
        const jobId = crypto.randomUUID();
        const started = await evaluateJson(createJobStartExpression(command, jobId), invokeOptions.signal, remainingMs);
        if (!started || typeof started !== 'object' || (started as { jobId?: unknown }).jobId !== jobId) {
          return failure('malformed-result', 'Inspected page did not acknowledge the diagnostic job') as Result<T>;
        }

        let reply: JobReply;
        do {
          if (pollIntervalMs > 0) await delay(Math.min(pollIntervalMs, remainingMs()), invokeOptions.signal);
          reply = await evaluateJson(createJobPollExpression(jobId), invokeOptions.signal, remainingMs) as JobReply;
        } while (reply.state === 'pending');

        if (reply.state === 'missing') return failure('stale-result', 'The inspected-page diagnostic job expired') as Result<T>;
        if (reply.state === 'failed') return failure('evaluation-failed', reply.error) as Result<T>;

        const currentOrigin = await waitFor(Promise.resolve().then(getOrigin), invokeOptions.signal, remainingMs());
        if (requestGeneration !== generation || requestOrigin !== currentOrigin) {
          return failure('stale-result', 'The inspected page changed before this result returned') as Result<T>;
        }
        if (!isResult(reply.result)) return failure('malformed-result', 'Inspected page returned an invalid diagnostic result') as Result<T>;
        return reply.result as Result<T>;
      } catch (error) {
        if (error instanceof Error && error.message === 'aborted') return failure('aborted', 'Inspection was cancelled') as Result<T>;
        if (error instanceof Error && error.message === 'timeout') return failure('timeout', 'Inspected-page operation timed out') as Result<T>;
        return failure('evaluation-failed', error instanceof Error ? error.message : String(error)) as Result<T>;
      }
    },
  };
}
