import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { env } from '@config/env';
import type { HealthProbe } from '@modules/health/domain/health-probe.port';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';

/**
 * Consultar os atributos da fila de entrada é a chamada mais barata que prova credencial,
 * endpoint e fila existente de uma vez. A fila de saída usa o mesmo endpoint e não acrescentaria.
 */
@Injectable()
export class QueueProbe implements HealthProbe, OnModuleDestroy {
  readonly name = 'queue';

  private readonly client = new SQSClient({
    region: env.AWS_REGION,
    endpoint: env.AWS_ENDPOINT_URL,
  });

  async check(): Promise<void> {
    await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: env.SQS_WAGER_QUEUE_URL,
        AttributeNames: ['QueueArn'],
      }),
    );
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
