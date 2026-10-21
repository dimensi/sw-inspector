import type { PageIdentity } from '../domain/types';
export type MessagingCommand =
  | { type: 'open-message-session'; expectedPage: PageIdentity }
  | { type: 'start-message-listener'; expectedPage: PageIdentity; sessionId: string }
  | { type: 'read-message-events'; expectedPage: PageIdentity; sessionId: string; afterSeq: number }
  | { type: 'stop-message-session'; expectedPage: PageIdentity; sessionId: string };
export type MessageSession = { sessionId: string; page: PageIdentity; expiresAt: number };
export type MessageRecord = {
  seq: number; timestamp: number; direction: 'outgoing' | 'incoming' | 'reply' | 'system';
  sourceURL: string | null; requestId: string | null; text: string; truncated: boolean;
  status: 'posted' | 'received' | 'reply-timeout' | 'message-error';
};
export type MessageBatch = { sessionId: string; records: MessageRecord[]; nextSeq: number; dropped: number; listening: boolean; expiresAt: number };
