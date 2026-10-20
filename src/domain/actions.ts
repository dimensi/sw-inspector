import type { WorkerSlot } from '../bridge/page-context';
import type { PageIdentity } from './types';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ActionIntent =
  | { kind: 'delete-cache'; cacheName: string }
  | { kind: 'delete-all-caches' }
  | { kind: 'delete-cache-entry'; cacheName: string; requestKey: string }
  | { kind: 'update-worker' | 'unregister-worker'; registrationId: string }
  | { kind: 'send-worker-message'; sessionId: string; registrationId: string; workerId: string;
      slot: WorkerSlot; jsonText: string; reply: 'none' | 'port' };
export type ActionKind = ActionIntent['kind'];
export type ActionTicket = { ticketId: string; operationId: string; page: PageIdentity;
  expiresAt: number; kind: ActionKind; summary: string[] };
export type ActionItem = { target: string; outcome: 'applied' | 'absent' | 'failed' | 'skipped'; message?: string };
export type ActionReceipt = { operationId: string; kind: ActionKind;
  status: 'completed' | 'partial'; items: ActionItem[] };
export type ControlCommand =
  | { type: 'prepare-action'; expectedPage: PageIdentity; intent: ActionIntent }
  | { type: 'commit-action'; expectedPage: PageIdentity; ticketId: string };
export interface ActionHandler {
  prepare(intent: ActionIntent): Promise<{ summary: string[]; retained: unknown }>;
  execute(retained: unknown, isCurrent: () => boolean): Promise<ActionItem[]>;
}
export type ActionHandlers = Partial<Record<ActionKind, ActionHandler>>;
export type ActionRejection = { kind: 'action-rejected';
  code: 'stale-target' | 'invalid-command' | 'unsupported' | 'cache-not-found'; message: string };
