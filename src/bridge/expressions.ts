import type { InspectorCommand } from '../domain/commands';
import { createControlRunner } from '../actions/page-runner';
import { createPageContext } from './page-context';
import { createPageRunner } from '../diagnostics/page-runner';

const contextRegistryKey = `__swInspectorContext_${crypto.randomUUID()}`;
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

export function createJobStartExpression(command: InspectorCommand, jobId: string): string {
  return `(function () {
    const jobsKey = ${serialize(jobRegistryKey)};
    const jobs = globalThis[jobsKey] instanceof Map ? globalThis[jobsKey] : (globalThis[jobsKey] = new Map());
    const id = ${serialize(jobId)};
    const record = { state: 'pending' };
    jobs.set(id, record);
    Promise.resolve().then(() => {
      const context = (${createPageContext.toString()})(${serialize(contextRegistryKey)});
      const command = ${serialize(command)};
      const handlers = {};
      return command.type === 'prepare-action' || command.type === 'commit-action'
        ? (${createControlRunner.toString()})(context, handlers)(command)
        : (${createPageRunner.toString()})(${serialize(snapshotRegistryKey)}, context)(command);
    }).then(
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

export function createPageIdentityExpression(): string {
  return `JSON.stringify((${createPageContext.toString()})(${serialize(contextRegistryKey)}).identity())`;
}
