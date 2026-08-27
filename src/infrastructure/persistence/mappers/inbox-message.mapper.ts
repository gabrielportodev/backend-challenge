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

export function inboxToEntity(message: InboxMessage): InboxMessageEntity {
  const row = new InboxMessageEntity();

  row.consumerName = message.consumerName;
  row.messageId = message.messageId;
  row.payloadHash = message.payloadHash;
  row.receivedAt = message.receivedAt;
  row.processedAt = message.processedAt;

  return row;
}
