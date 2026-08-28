import { EntityManager } from '@mikro-orm/postgresql';
import type { InboxRepository } from '@modules/messaging/domain/inbox.repository.port';
import type { InboxMessage } from '@modules/messaging/domain/inbox-message.entity';
import { Inject, Injectable } from '@nestjs/common';
import { isUniqueViolation } from '@shared/infra/persistence/database-error';
import { DuplicateTransactionError } from '@shared/kernel/duplicate-transaction.error';
import { inboxToEntity } from './inbox-message.mapper';
import { InboxMessageEntity } from './inbox-message.mikro-entity';

@Injectable()
export class MikroInboxRepository implements InboxRepository {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  /** Colide na PK quando a fila reentrega: a mensagem já foi processada e commitada. */
  async insert(message: InboxMessage): Promise<void> {
    try {
      await this.em.insert(InboxMessageEntity, inboxToEntity(message));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateTransactionError('inbox_messages');
      }

      throw error;
    }
  }

  async update(message: InboxMessage): Promise<void> {
    await this.em.nativeUpdate(
      InboxMessageEntity,
      { consumerName: message.consumerName, messageId: message.messageId },
      { processedAt: message.processedAt },
    );
  }
}
