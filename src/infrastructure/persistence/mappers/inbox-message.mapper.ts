import { InboxMessage } from '@domain/messaging/inbox-message';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

export function inboxToDomain(row: InboxMessageEntity): InboxMessage {
  return InboxMessage.rehydrate({
    messageId: row.messageId,
    consumerName: row.consumerName,
    payloadHash: row.payloadHash,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
  });
}

/** Recebe a linha já carregada quando é update; sem ela, monta uma nova para insert. */
export function inboxToEntity(
  message: InboxMessage,
  row: InboxMessageEntity = new InboxMessageEntity(),
): InboxMessageEntity {
  row.consumerName = message.consumerName;
  row.messageId = message.messageId;
  row.payloadHash = message.payloadHash;
  row.receivedAt = message.receivedAt;
  row.processedAt = message.processedAt;

  return row;
}
