import type { OutboxRepository } from '@application/ports';
import type { OutboxMessage } from '@domain/messaging/outbox-message';
import { type EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { OutboxMessageEntity } from '../entities';
import { outboxToDomain, outboxToEntity } from '../mappers';

@Injectable()
export class MikroOutboxRepository implements OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async enqueue(message: OutboxMessage): Promise<void> {
    await this.em.insert(OutboxMessageEntity, outboxToEntity(message));
  }

  /**
   * FOR UPDATE SKIP LOCKED: o segundo publisher ignora as linhas que o primeiro já pegou
   * em vez de esperar por elas, então várias instâncias publicam em paralelo sem repetir trabalho.
   */
  async findDue(limit: number, now: Date): Promise<OutboxMessage[]> {
    const rows = await this.em
      .createQueryBuilder(OutboxMessageEntity, 'o')
      .select('*')
      .where({
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      })
      .orderBy({ occurredAt: 'asc' })
      .limit(limit)
      .setLockMode(LockMode.PESSIMISTIC_PARTIAL_WRITE)
      .getResultList();

    return rows.map(outboxToDomain);
  }

  async update(message: OutboxMessage): Promise<void> {
    await this.em.nativeUpdate(
      OutboxMessageEntity,
      { id: message.id },
      {
        attempts: message.attempts,
        nextAttemptAt: message.nextAttemptAt,
        publishedAt: message.publishedAt,
      },
    );
  }
}
