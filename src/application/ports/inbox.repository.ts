import type { InboxMessage } from '@domain/messaging/inbox-message';

export const INBOX_REPOSITORY = 'InboxRepository';

export interface InboxRepository {
  find(consumerName: string, messageId: string): Promise<InboxMessage | null>;

  /** Colide na PK `(consumer_name, message_id)` quando a fila reentrega a mesma mensagem. */
  insert(message: InboxMessage): Promise<void>;

  update(message: InboxMessage): Promise<void>;
}
