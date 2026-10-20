import type { InspectorCommand } from '../domain/commands';
import { createJobPollExpression, createJobStartExpression, createPageIdentityExpression } from './expressions';
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

const actionKinds = ['delete-cache', 'delete-all-caches', 'delete-cache-entry', 'update-worker', 'unregister-worker', 'send-worker-message'];
const safeRejections = ['stale-target', 'action-expired', 'action-busy', 'invalid-command', 'unsupported', 'cache-not-found'];
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function pageMatches(value: unknown, expected: { documentId: string; origin: string; url: string }): boolean {
  return object(value) && value.documentId === expected.documentId && value.origin === expected.origin && value.url === expected.url;
}
function validControlResult(value: unknown, command: InspectorCommand): value is Result<unknown> {
  if (!object(value)) return false;
  if (value.ok === false) return object(value.error) && typeof value.error.message === 'string'
    && typeof value.error.code === 'string' && [...safeRejections, 'outcome-unknown', ...(command.type === 'prepare-action' ? ['evaluation-failed'] : [])].includes(value.error.code);
  if (value.ok !== true || !object(value.value)) return false;
  const item = value.value;
  if (typeof item.operationId !== 'string' || typeof item.kind !== 'string' || !actionKinds.includes(item.kind)) return false;
  if (command.type === 'prepare-action') return typeof item.ticketId === 'string'
    && typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt)
    && item.kind === command.intent.kind && pageMatches(item.page, command.expectedPage)
    && Array.isArray(item.summary) && item.summary.every(line => typeof line === 'string');
  return (item.status === 'completed' || item.status === 'partial') && Array.isArray(item.items)
    && item.items.every(entry => object(entry) && typeof entry.target === 'string'
      && typeof entry.outcome === 'string' && ['applied', 'absent', 'failed', 'skipped'].includes(entry.outcome)
      && (entry.message === undefined || typeof entry.message === 'string'))
    && (item.status === 'partial') === item.items.some(entry => entry.outcome === 'failed' || entry.outcome === 'skipped');
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

      let commitAttempted = false;
      const uncertain = () => failure('outcome-unknown', 'The action may have completed. Refresh to inspect the current state.') as Result<T>;
      const failed = (code: DiagnosticErrorCode, message: string) => commitAttempted ? uncertain() : failure(code, message) as Result<T>;
      try {
        const requestOrigin = await waitFor(Promise.resolve().then(getOrigin), invokeOptions.signal, remainingMs());
        const jobId = crypto.randomUUID();
        const source = createJobStartExpression(command, jobId);
        if (invokeOptions.signal?.aborted) throw new Error('aborted');
        const startTimeout = remainingMs();
        commitAttempted = command.type === 'commit-action';
        const [rawStart, startException] = await waitFor(evaluate(source), invokeOptions.signal, startTimeout);
        if (startException?.isException || startException?.isError) throw new Error(exceptionMessage(startException));
        const started = jsonReply(rawStart);
        if (!started || typeof started !== 'object' || (started as { jobId?: unknown }).jobId !== jobId) {
          return failed('malformed-result', 'Inspected page did not acknowledge the diagnostic job');
        }

        let reply: JobReply;
        do {
          if (pollIntervalMs > 0) await delay(Math.min(pollIntervalMs, remainingMs()), invokeOptions.signal);
          reply = await evaluateJson(createJobPollExpression(jobId), invokeOptions.signal, remainingMs) as JobReply;
        } while (reply?.state === 'pending');

        if (reply?.state === 'missing') return failed('stale-result', 'The inspected-page diagnostic job expired');
        if (reply?.state === 'failed') return failed('evaluation-failed', reply.error);
        if (reply?.state !== 'complete') return failed('malformed-result', 'Inspected page returned an invalid job reply');

        const currentOrigin = await waitFor(Promise.resolve().then(getOrigin), invokeOptions.signal, remainingMs());
        if (requestGeneration !== generation || requestOrigin !== currentOrigin) {
          return failed('stale-result', 'The inspected page changed before this result returned');
        }
        const control = command.type === 'prepare-action' || command.type === 'commit-action';
        if (!(control ? validControlResult(reply.result, command) : isResult(reply.result))) {
          return failed('malformed-result', 'Inspected page returned an invalid diagnostic result');
        }
        if (control && isResult(reply.result) && reply.result.ok) {
          const currentPage = await evaluateJson(createPageIdentityExpression(), invokeOptions.signal, remainingMs);
          if (!pageMatches(currentPage, command.expectedPage) || requestGeneration !== generation) {
            return failed('stale-result', 'The inspected document changed before this result returned');
          }
        }
        if (control && isResult(reply.result) && !reply.result.ok && reply.result.error.code === 'outcome-unknown') return uncertain();
        return reply.result as Result<T>;
      } catch (error) {
        if (error instanceof Error && error.message === 'aborted') return failed('aborted', 'Inspection was cancelled');
        if (error instanceof Error && error.message === 'timeout') return failed('timeout', 'Inspected-page operation timed out');
        return failed('evaluation-failed', error instanceof Error ? error.message : String(error));
      }
    },
  };
}
