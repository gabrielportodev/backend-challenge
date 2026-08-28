import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { env } from '@config/env';
import type {
  MessagePublisherPort,
  OutgoingMessage,
} from '@modules/messaging/domain/message-publisher.port';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';

/**
 * Publica os eventos do outbox, sempre depois do commit. A deduplicação e a ordem do FIFO
 * são otimização: o mesmo evento pode chegar duas vezes e o consumidor tem que aguentar.
 */
@Injectable()
export class SqsMessagePublisher implements MessagePublisherPort, OnModuleDestroy {
  // O endpoint só é definido em desenvolvimento, para apontar ao LocalStack no lugar da AWS.
  private readonly client = new SQSClient({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL,
  });

  async publish(message: OutgoingMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: env.SQS_EVENTS_QUEUE_URL,
        MessageBody: message.body,
        MessageGroupId: message.groupId,
        MessageDeduplicationId: message.id,
      }),
    );
  }

  /** Fecha os sockets do SDK no shutdown, senão o processo não termina sozinho. */
  onModuleDestroy(): void {
    this.client.destroy();
  }
}
