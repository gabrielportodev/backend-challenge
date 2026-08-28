import type { InboxMessage } from './inbox-message.entity';

export const INBOX_REPOSITORY = 'InboxRepository';

export interface InboxRepository {
  /** Colide na PK `(consumer_name, message_id)` quando a fila reentrega a mesma mensagem. */
  insert(message: InboxMessage): Promise<void>;

  update(message: InboxMessage): Promise<void>;
}
