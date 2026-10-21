import type { PageIdentity } from '../domain/types';
import type { MessageRecord } from './types';
export type MessageSessionRecord = {
  identity: PageIdentity; id: string; expiresAt: number; nextSeq: number; dropped: number;
  rows: MessageRecord[]; byteCount: number; listening: boolean;
  cleanups: Set<() => void>; ports: Set<MessagePort>;
  append(row: Omit<MessageRecord, 'seq' | 'timestamp'>): void;
};
