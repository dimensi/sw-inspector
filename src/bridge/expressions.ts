import type { DiagnosticCommand } from '../domain/types';
import { createPageRunner } from '../diagnostics/page-runner';

const snapshotRegistryKey = `__swInspectorSnapshots_${crypto.randomUUID()}`;
const jobRegistryKey = `__swInspectorJobs_${crypto.randomUUID()}`;

function serialize(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function createJobStartExpression(command: DiagnosticCommand, jobId: string): string {
  return `(function () {
    const jobsKey = ${serialize(jobRegistryKey)};
    const jobs = globalThis[jobsKey] instanceof Map ? globalThis[jobsKey] : (globalThis[jobsKey] = new Map());
    const id = ${serialize(jobId)};
    const record = { state: 'pending' };
    jobs.set(id, record);
    Promise.resolve().then(() => (${createPageRunner.toString()})(${serialize(snapshotRegistryKey)})(${serialize(command)})).then(
      (result) => { record.state = 'complete'; record.result = result; },
      (error) => { record.state = 'failed'; record.error = error instanceof Error ? error.message : String(error); },
    );
    setTimeout(() => jobs.delete(id), 60_000);
    return JSON.stringify({ jobId: id });
  })()`;
}

export function createJobPollExpression(jobId: string): string {
  return `(function () {
    const jobs = globalThis[${serialize(jobRegistryKey)}];
    const job = jobs instanceof Map ? jobs.get(${serialize(jobId)}) : undefined;
    if (!job) return JSON.stringify({ state: 'missing' });
    if (job.state === 'pending') return JSON.stringify({ state: 'pending' });
    jobs.delete(${serialize(jobId)});
    return JSON.stringify(job);
  })()`;
}
