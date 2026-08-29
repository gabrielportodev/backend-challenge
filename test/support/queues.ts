import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  type QueueAttributeName,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { env } from '@config/env';
import type { SubmitTransactionBody } from '@modules/wagering/infra/http/wagering.dto';

const client = new SQSClient({ region: env.AWS_REGION, endpoint: env.AWS_ENDPOINT_URL });

export const QUEUES = {
  wager: env.SQS_WAGER_QUEUE_URL,
  dlq: env.SQS_WAGER_DLQ_URL,
  events: env.SQS_EVENTS_QUEUE_URL,
};

export interface QueuedMessage {
  id: string;
  receiptHandle: string;
  body: string;
}

/** Publica na fila de entrada como um provedor faria. FIFO exige grupo e chave de deduplicação. */
export async function sendToQueue(url: string, body: unknown, groupId: string): Promise<void> {
  await client.send(
    new SendMessageCommand({
      QueueUrl: url,
      MessageBody: JSON.stringify(body),
      MessageGroupId: groupId,
      MessageDeduplicationId: crypto.randomUUID(),
    }),
  );
}

export async function receiveFrom(
  url: string,
  max = 10,
  waitSeconds = 1,
): Promise<QueuedMessage[]> {
  const result = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: max,
      WaitTimeSeconds: waitSeconds,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }),
  );

  return (result.Messages ?? []).map((message) => ({
    id: message.MessageId ?? '',
    receiptHandle: message.ReceiptHandle ?? '',
    body: message.Body ?? '',
  }));
}

export async function deleteFrom(url: string, message: QueuedMessage): Promise<void> {
  await client.send(
    new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.receiptHandle }),
  );
}

/** Lê e apaga tudo o que estiver visível: é assim que um teste começa com as filas limpas. */
export async function drainQueue(url: string): Promise<QueuedMessage[]> {
  const drained: QueuedMessage[] = [];

  for (let empty = 0; empty < 2; ) {
    const messages = await receiveFrom(url, 10, 0);

    if (messages.length === 0) {
      empty += 1;
      continue;
    }

    for (const message of messages) {
      await deleteFrom(url, message);
      drained.push(message);
    }
  }

  return drained;
}

export async function drainAllQueues(): Promise<void> {
  for (const url of Object.values(QUEUES)) {
    await drainQueue(url);
  }
}

/**
 * Espera até `count` mensagens aparecerem, ou devolve o que juntou até o prazo acabar. O filtro
 * conta apenas as mensagens que interessam ao teste: sem ele, uma mensagem de outra wallet ocupa
 * uma das vagas e o teste recebe menos do que pediu.
 */
export async function collectMessages(
  url: string,
  count: number,
  timeoutMs = 15_000,
  matches: (message: QueuedMessage) => boolean = () => true,
): Promise<QueuedMessage[]> {
  const collected: QueuedMessage[] = [];
  const deadline = Date.now() + timeoutMs;

  while (collected.length < count && Date.now() < deadline) {
    const messages = await receiveFrom(url, 10, 1);

    for (const message of messages) {
      await deleteFrom(url, message);

      if (matches(message)) {
        collected.push(message);
      }
    }
  }

  return collected;
}

export interface QueueDepth {
  visible: number;
  inFlight: number;
}

export async function queueDepth(url: string): Promise<QueueDepth> {
  const result = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );

  return {
    visible: Number(result.Attributes?.ApproximateNumberOfMessages ?? 0),
    inFlight: Number(result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
  };
}

/** O envelope que o provedor publica: mesmo formato aceito pelo consumidor. */
export function wagerMessage(
  messageId: string,
  payload: SubmitTransactionBody,
  idempotencyKey: string,
) {
  return {
    messageId,
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: { ...payload, idempotencyKey },
  };
}

export function closeQueueClient(): void {
  client.destroy();
}

/** Um atributo da fila, como a redrive policy — o que prova que a DLQ está ligada de verdade. */
export async function queueAttribute(
  url: string,
  name: QueueAttributeName,
): Promise<string | undefined> {
  const result = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: [name] }),
  );

  return result.Attributes?.[name];
}
