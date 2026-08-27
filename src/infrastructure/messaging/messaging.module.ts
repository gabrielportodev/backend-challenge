import { MESSAGE_PUBLISHER } from '@application/ports';
import { Module } from '@nestjs/common';
import { SqsMessagePublisher } from './sqs-message-publisher';

@Module({
  providers: [{ provide: MESSAGE_PUBLISHER, useClass: SqsMessagePublisher }],
  exports: [MESSAGE_PUBLISHER],
})
export class MessagingModule {}
