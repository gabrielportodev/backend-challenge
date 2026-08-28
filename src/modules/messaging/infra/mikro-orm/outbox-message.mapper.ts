import { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import { OutboxMessageEntity } from './outbox-message.mikro-entity';

// A coluna nula chega como null, e o domínio trabalha com undefined: a troca acontece aqui, uma vez.
const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

export function outboxToDomain(row: OutboxMessageEntity): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: row.id,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload: row.payload,
    occurredAt: row.occurredAt,
    attempts: row.attempts,
    nextAttemptAt: orUndefined(row.nextAttemptAt),
    publishedAt: orUndefined(row.publishedAt),
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
