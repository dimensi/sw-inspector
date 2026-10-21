import type { PageContext, RetainedRegistration } from '../bridge/page-context';
import type { ActionHandlers, ActionIntent, ActionItem, ActionRejection } from '../domain/actions';
import type { MessageSessionRecord } from './session-types';
import type { formatMessagePreview } from './preview';

// Serialized into the inspected document; formatter is explicitly injected.
export function createMessageActions(context: PageContext, formatPreview: typeof formatMessagePreview): ActionHandlers {
  type Intent = Extract<ActionIntent, { kind: 'send-worker-message' }>;
  type Retained = { intent: Intent; record: RetainedRegistration; session: MessageSessionRecord;
    worker: ServiceWorker; value: unknown; requestId: string };
  function reject(code: ActionRejection['code'], message: string): never {
    throw { kind: 'action-rejected', code, message } satisfies ActionRejection;
  }
  function validate(target: Retained, isCurrent: () => boolean = () => true) {
    const { intent, record, session, worker } = target;
    const runtime = context.messages.get('message:runtime:v1') as { active?: MessageSessionRecord } | undefined;
    if (!isCurrent() || !context.isCurrent(record.page) || !context.isCurrent(session.identity)
      || record.expiresAt <= Date.now() || session.expiresAt <= Date.now()
      || context.registrations.get(intent.registrationId) !== record
      || context.messages.get(intent.sessionId) !== session || runtime?.active !== session
      || record.workers[intent.slot]?.workerId !== intent.workerId
      || record.workers[intent.slot]?.worker !== worker
      || record.registration[intent.slot] !== worker || worker.state === 'redundant') {
      reject('stale-target', 'Refresh and select the worker again before sending.');
    }
  }
  return { 'send-worker-message': {
    async prepare(input) {
      if (input.kind !== 'send-worker-message') return reject('invalid-command', 'Invalid message action.');
      if (input.reply !== 'none') return reject('unsupported', 'Port replies are not supported yet.');
      if (input.jsonText.length > 16384 || new TextEncoder().encode(input.jsonText).byteLength > 16384) return reject('invalid-command', 'JSON must be at most 16 KiB UTF-8.');
      let value: unknown;
      try { value = JSON.parse(input.jsonText); } catch { return reject('invalid-command', 'Enter valid JSON.'); }
      const record = context.registrations.get(input.registrationId);
      const session = context.messages.get(input.sessionId) as MessageSessionRecord | undefined;
      const worker = record?.workers[input.slot]?.worker;
      if (!record || !session || !worker) return reject('stale-target', 'Refresh and select the worker again before sending.');
      const retained: Retained = { intent: { ...input }, record, session, worker, value, requestId: crypto.randomUUID() };
      validate(retained);
      if (!('serviceWorker' in navigator)) return reject('unsupported', 'Service Worker API is unavailable.');
      const registrations = await navigator.serviceWorker.getRegistrations();
      validate(retained);
      if (!registrations.includes(record.registration)) return reject('stale-target', 'Registration is no longer available.');
      return { retained, summary: [record.page.origin, record.page.url, record.registration.scope,
        input.slot, worker.scriptURL, input.jsonText, input.reply,
        'This sends data to website code and may change website state.'] };
    },
    async execute(value, isCurrent): Promise<ActionItem[]> {
      const retained = value as Retained;
      validate(retained, isCurrent);
      if (!('serviceWorker' in navigator)) return reject('unsupported', 'Service Worker API is unavailable.');
      const registrations = await navigator.serviceWorker.getRegistrations();
      validate(retained, isCurrent);
      if (!registrations.includes(retained.record.registration)) return reject('stale-target', 'Registration is no longer available.');
      const target = retained.worker.scriptURL;
      try { retained.worker.postMessage(retained.value); }
      catch { return [{ target, outcome: 'failed', message: 'Message could not be posted.' }]; }
      const preview = formatPreview(retained.value);
      retained.session.append({ direction: 'outgoing', sourceURL: target, requestId: retained.requestId,
        text: preview.text, truncated: preview.truncated, status: 'posted' });
      return [{ target, outcome: 'applied', message: 'Message posted. Delivery is not confirmed.' }];
    },
  } };
}
