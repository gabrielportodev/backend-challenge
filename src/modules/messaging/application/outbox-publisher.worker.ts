import {
  MESSAGE_PUBLISHER,
  type MessagePublisherPort,
} from '@modules/messaging/domain/message-publisher.port';
import {
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from '@modules/messaging/domain/outbox.repository.port';
import type { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { MetricsService } from '@shared/infra/metrics/metrics.service';
import { TRANSACTION_RUNNER, type TransactionRunner } from '@shared/kernel/transaction-runner.port';

const BATCH_SIZE = 20;
/** Espera entre as varreduras quando não havia nada pendente. */
const IDLE_DELAY_MS = 1_000;
/** Espera maior quando a própria varredura falhou — normalmente o banco fora do ar. */
const ERROR_DELAY_MS = 5_000;

/**
 * Publica os eventos que a transação financeira deixou na outbox. Roda em todas as instâncias:
 * a seleção é feita com `FOR UPDATE SKIP LOCKED`, então cada publisher pega um lote diferente.
 *
 * A publicação acontece com a transação aberta e as linhas travadas. Se o processo morrer entre
 * o envio e o commit, o evento é publicado de novo mais tarde. Publicar duas vezes é seguro: o
 * `eventId` é a chave de deduplicação da fila e o consumidor é idempotente.
 */
@Injectable()
export class OutboxPublisherWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private running = false;
  private loop?: Promise<void>;
  /** Interrompe a espera entre varreduras, para o shutdown não ficar preso no `setTimeout`. */
  private wakeUp?: () => void;

  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisherPort,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
  }

  /** Para de agendar e espera a varredura em andamento terminar, para não morrer no meio dela. */
  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.wakeUp?.();

    await this.loop;
  }

  /**
   * Uma varredura: pega o lote pendente já travado, tenta publicar cada evento e grava o
   * resultado. Devolve quantos eventos foram tratados.
   */
  async publishPending(now = new Date()): Promise<number> {
    return this.transaction.run(async () => {
      const due = await this.outbox.findDue(BATCH_SIZE, now);

      // O lote vem do mais antigo para o mais novo, então o primeiro mede o atraso da publicação.
      const oldest = due[0];
      this.metrics.outboxLagSeconds(
        oldest ? (now.getTime() - oldest.occurredAt.getTime()) / 1_000 : 0,
      );

      for (const message of due) {
        await this.publishOne(message, now);
      }

      return due.length;
    });
  }

  private async publishOne(message: OutboxMessage, now: Date): Promise<void> {
    try {
      await this.publisher.publish({
        id: message.id,
        groupId: message.aggregateId,
        body: JSON.stringify(message.payload),
      });

      message.markPublished(now);
    } catch (error) {
      // Falha de publicação não derruba o lote: a linha volta com o retry adiado.
      message.scheduleRetry(now);
      this.metrics.retryScheduled('outbox');

      this.logger.warn({
        msg: 'Falha ao publicar evento',
        eventId: message.id,
        eventType: message.eventType,
        aggregateId: message.aggregateId,
        attempt: message.attempts,
        reason: (error as Error).message,
      });
    }

    await this.outbox.update(message);
  }

  private async run(): Promise<void> {
    while (this.running) {
      let delay = IDLE_DELAY_MS;

      try {
        // Lote cheio provavelmente significa que ainda há fila: varre de novo sem esperar.
        const published = await this.publishPending();

        if (published === BATCH_SIZE) {
          continue;
        }
      } catch (error) {
        this.logger.error({
          msg: 'Varredura do outbox falhou',
          reason: (error as Error).message,
        });
        delay = ERROR_DELAY_MS;
      }

      await this.wait(delay);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);

      this.wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
