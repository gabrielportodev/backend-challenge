import type { InboxRepository } from '@application/ports';
import type { InboxMessage } from '@domain/messaging/inbox-message';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { InboxMessageEntity } from '../entities';
import { inboxToDomain, inboxToEntity } from '../mappers';

@Injectable()
export class MikroInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async find(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const row = await this.em.findOne(InboxMessageEntity, { consumerName, messageId });

    return row ? inboxToDomain(row) : null;
  }

  async insert(message: InboxMessage): Promise<void> {
    await this.em.insert(InboxMessageEntity, inboxToEntity(message));
  }

  async update(message: InboxMessage): Promise<void> {
    await this.em.nativeUpdate(
      InboxMessageEntity,
      { consumerName: message.consumerName, messageId: message.messageId },
      { processedAt: message.processedAt },
    );
  }
}
