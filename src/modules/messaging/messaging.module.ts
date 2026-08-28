import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { INBOX_REPOSITORY } from './domain/inbox.repository.port';
import { MESSAGE_PUBLISHER } from './domain/message-publisher.port';
import { OUTBOX_REPOSITORY } from './domain/outbox.repository.port';
import { MikroInboxRepository } from './infra/mikro-orm/inbox.repository';
import { MikroOutboxRepository } from './infra/mikro-orm/outbox.repository';
import { SqsMessagePublisher } from './infra/sqs/sqs-message-publisher';

const providers = [
  { provide: INBOX_REPOSITORY, useClass: MikroInboxRepository },
  { provide: OUTBOX_REPOSITORY, useClass: MikroOutboxRepository },
  { provide: MESSAGE_PUBLISHER, useClass: SqsMessagePublisher },
];

// Inbox, outbox e publicação são infraestrutura de todos os contextos, não regra de nenhum.
@Module({
  imports: [PersistenceModule],
  providers,
  exports: providers.map((provider) => provider.provide),
})
export class MessagingModule {}
