import { OutboxMessage } from '@domain/messaging/outbox-message';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

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

/** Recebe a linha já carregada quando é update; sem ela, monta uma nova para insert. */
export function outboxToEntity(
  message: OutboxMessage,
  row: OutboxMessageEntity = new OutboxMessageEntity(),
): OutboxMessageEntity {
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
