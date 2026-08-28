import { InboxMessage } from '@modules/messaging/domain/inbox-message.entity';
import { InboxMessageEntity } from './inbox-message.mikro-entity';

export function inboxToDomain(row: InboxMessageEntity): InboxMessage {
  return InboxMessage.rehydrate({
    messageId: row.messageId,
    consumerName: row.consumerName,
    payloadHash: row.payloadHash,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? undefined,
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
