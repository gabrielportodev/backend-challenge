import { DuplicateTransactionError } from '@application/errors';
import type { InboxRepository } from '@application/ports';
import type { InboxMessage } from '@domain/messaging/inbox-message';
import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../database-error';
import { InboxMessageEntity } from '../entities';
import { inboxToEntity } from '../mappers';

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
