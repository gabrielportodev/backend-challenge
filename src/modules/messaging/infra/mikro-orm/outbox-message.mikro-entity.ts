import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';
import type { IntegrationEventEnvelope } from '@shared/kernel/integration-event';

@Entity({ tableName: 'outbox_messages' })
// Busca do worker publicador: só as linhas ainda não publicadas entram no índice.
@Index({
  name: 'outbox_messages_pending_idx',
  expression: `create index "outbox_messages_pending_idx"
    on "outbox_messages" ("next_attempt_at", "occurred_at")
    where "published_at" is null`,
})
export class OutboxMessageEntity {
  // É o eventId do evento: republicar o mesmo evento não cria linha nova.
  @PrimaryKey({ columnType: 'uuid' })
  id!: string;

  @Property({ columnType: 'uuid' })
  aggregateId!: string;

  @Property({ columnType: 'varchar(64)' })
  eventType!: string;

  @Property({ type: 'json', columnType: 'jsonb' })
  payload!: IntegrationEventEnvelope<unknown>;

  @Property({ columnType: 'timestamptz' })
  occurredAt!: Date;

  @Property({ columnType: 'int', default: 0 })
  attempts!: number;

  @Property({ columnType: 'timestamptz', nullable: true })
  nextAttemptAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  publishedAt?: Date;
}
