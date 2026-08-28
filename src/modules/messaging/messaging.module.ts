import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { OutboxPublisherWorker } from './application/outbox-publisher.worker';
import { INBOX_REPOSITORY } from './domain/inbox.repository.port';
import { MESSAGE_CONSUMER } from './domain/message-consumer.port';
import { MESSAGE_PUBLISHER } from './domain/message-publisher.port';
import { OUTBOX_REPOSITORY } from './domain/outbox.repository.port';
import { MikroInboxRepository } from './infra/mikro-orm/inbox.repository';
import { MikroOutboxRepository } from './infra/mikro-orm/outbox.repository';
import { SqsMessageConsumer } from './infra/sqs/sqs-message-consumer';
import { SqsMessagePublisher } from './infra/sqs/sqs-message-publisher';

const providers = [
  { provide: INBOX_REPOSITORY, useClass: MikroInboxRepository },
  { provide: OUTBOX_REPOSITORY, useClass: MikroOutboxRepository },
  { provide: MESSAGE_PUBLISHER, useClass: SqsMessagePublisher },
  { provide: MESSAGE_CONSUMER, useClass: SqsMessageConsumer },
];

// Inbox, outbox e transporte são infraestrutura de todos os contextos, não regra de nenhum.
// Quem consome a fila é o contexto de wagering; daqui sai só o acesso a ela.
@Module({
  imports: [PersistenceModule],
  providers: [...providers, OutboxPublisherWorker],
  exports: providers.map((provider) => provider.provide),
})
export class MessagingModule {}
