import { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import { OutboxMessageEntity } from './outbox-message.mikro-entity';

export function outboxToDomain(row: OutboxMessageEntity): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: row.id,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload: row.payload,
    occurredAt: row.occurredAt,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    publishedAt: row.publishedAt,
  });
}

export function outboxToEntity(message: OutboxMessage): OutboxMessageEntity {
  const row = new OutboxMessageEntity();

  row.id = message.id;
  row.aggregateId = message.aggregateId;
  row.eventType = message.eventType;
  row.payload = message.payload;
  row.occurredAt = message.occurredAt;
  row.attempts = message.attempts;
  row.nextAttemptAt = message.nextAttemptAt;
  row.publishedAt = message.publishedAt;

  return row;
}
