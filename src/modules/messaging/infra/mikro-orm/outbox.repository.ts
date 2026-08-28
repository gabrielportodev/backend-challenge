import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import type { OutboxRepository } from '@modules/messaging/domain/outbox.repository.port';
import type { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import { Inject, Injectable } from '@nestjs/common';
import { outboxToDomain, outboxToEntity } from './outbox-message.mapper';
import { OutboxMessageEntity } from './outbox-message.mikro-entity';

@Injectable()
export class MikroOutboxRepository implements OutboxRepository {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

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
