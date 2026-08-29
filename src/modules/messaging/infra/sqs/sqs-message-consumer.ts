import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { env } from '@config/env';
import type {
  IncomingMessage,
  MessageConsumerPort,
} from '@modules/messaging/domain/message-consumer.port';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';

/**
 * Long polling: a leitura só volta antes disso se chegar mensagem. Também define quanto tempo o
 * shutdown espera, então valores altos atrasam o encerramento.
 */
const WAIT_TIME_SECONDS = 5;

@Injectable()
export class SqsMessageConsumer implements MessageConsumerPort, OnModuleDestroy {
  // O endpoint só é definido em desenvolvimento, para apontar ao LocalStack no lugar da AWS.
  private readonly client = new SQSClient({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL,
  });

  async receive(max: number): Promise<IncomingMessage[]> {
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: env.SQS_WAGER_QUEUE_URL,
        MaxNumberOfMessages: max,
        WaitTimeSeconds: WAIT_TIME_SECONDS,
        // Sem pedir explicitamente, a fila não conta as entregas e o limite de retry não existe.
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );

    return (result.Messages ?? []).map((message) => ({
      id: message.MessageId ?? '',
      receiptHandle: message.ReceiptHandle ?? '',
      receiveCount: Number(message.Attributes?.ApproximateReceiveCount ?? 1),
      body: message.Body ?? '',
    }));
  }

  async ack(message: IncomingMessage): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: env.SQS_WAGER_QUEUE_URL,
        ReceiptHandle: message.receiptHandle,
      }),
    );
  }

  /** Encurtar a visibilidade devolve a mensagem antes do prazo padrão, sem precisar reenviá-la. */
  async retryLater(message: IncomingMessage, delaySeconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: env.SQS_WAGER_QUEUE_URL,
        ReceiptHandle: message.receiptHandle,
        VisibilityTimeout: delaySeconds,
      }),
    );
  }

  /**
   * A redrive policy da fila já move o que estoura o `maxReceiveCount`, mas o envio direto atalha
   * o que nunca vai dar certo — envelope ilegível não melhora com mais quatro reentregas.
   *
   * Cada mensagem vai no próprio grupo: a DLQ é para inspeção humana, ordem ali não significa nada
   * e um grupo único travaria a fila atrás da primeira mensagem.
   */
  async deadLetter(message: IncomingMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: env.SQS_WAGER_DLQ_URL,
        MessageBody: message.body,
        MessageGroupId: message.id,
        MessageDeduplicationId: message.id,
      }),
    );
  }

  /** Fecha os sockets do SDK no shutdown, senão o processo não termina sozinho. */
  onModuleDestroy(): void {
    this.client.destroy();
  }
}
