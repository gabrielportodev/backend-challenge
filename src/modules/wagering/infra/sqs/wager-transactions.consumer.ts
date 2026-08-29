import {
  type IncomingMessage,
  MESSAGE_CONSUMER,
  type MessageConsumerPort,
} from '@modules/messaging/domain/message-consumer.port';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { DomainError } from '@shared/domain/errors';
import type { DeadLetterCause } from '@shared/infra/metrics/metrics.service';
import { MetricsService } from '@shared/infra/metrics/metrics.service';
import { type WagerMessage, wagerMessageSchema } from './wager-message.dto';

/** Identidade do consumidor no inbox: outro consumidor da mesma fila teria dedup próprio. */
const CONSUMER_NAME = 'wager-transactions';
const BATCH_SIZE = 10;
/** O mesmo `maxReceiveCount` da redrive policy — a fila desistiria aqui, e nós desistimos junto. */
const MAX_RECEIVES = 5;
const BASE_RETRY_SECONDS = 5;
const MAX_RETRY_SECONDS = 300;
/** Espera quando a própria leitura da fila falhou, para não girar em falso contra o broker. */
const ERROR_DELAY_MS = 5_000;

/** Espera crescente entre reentregas, com teto para a mensagem não sumir por horas. */
function retryDelaySeconds(receiveCount: number): number {
  return Math.min(BASE_RETRY_SECONDS * 2 ** (receiveCount - 1), MAX_RETRY_SECONDS);
}

/**
 * A segunda entrada do serviço. Não tem regra própria: valida o envelope, chama o mesmo use case
 * do HTTP e decide o que fazer com a mensagem conforme o resultado.
 *
 * O que ele acrescenta ao caminho HTTP é a dedup por inbox — o `messageId` entra na mesma
 * transação do dado financeiro, então reentrega vira replay em vez de segundo débito — e o `ack`
 * depois do commit. Nessa ordem: se o processo morrer entre um e outro, a fila reentrega e o
 * inbox reconhece; se fosse o contrário, a mensagem sumiria sem ter sido processada.
 */
@Injectable()
export class WagerTransactionsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WagerTransactionsConsumer.name);
  private running = false;
  private loop?: Promise<void>;
  /** Interrompe a espera entre tentativas, para o shutdown não ficar preso no `setTimeout`. */
  private wakeUp?: () => void;

  constructor(
    @Inject(MESSAGE_CONSUMER) private readonly queue: MessageConsumerPort,
    @Inject(SubmitWagerTransactionUseCase)
    private readonly submitTransaction: SubmitWagerTransactionUseCase,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
  }

  /**
   * Para de ler e espera o lote em andamento terminar. Cada mensagem já tratada foi apagada da
   * fila, e as que não chegaram a ser lidas continuam invisíveis por pouco tempo — nada se perde
   * e nada é processado pela metade.
   */
  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.wakeUp?.();

    await this.loop;
  }

  /** Um lote: lê da fila e trata cada mensagem em sequência. Devolve quantas foram lidas. */
  async consumeBatch(): Promise<number> {
    const messages = await this.queue.receive(BATCH_SIZE);

    for (const message of messages) {
      await this.handle(message);
    }

    return messages.length;
  }

  private async handle(message: IncomingMessage): Promise<void> {
    let envelope: WagerMessage;

    try {
      envelope = wagerMessageSchema.parse(JSON.parse(message.body));
    } catch (error) {
      // Falha permanente: nenhuma reentrega conserta um envelope que não dá para ler.
      await this.discard(message, 'invalid_envelope', (error as Error).message);
      return;
    }

    const { idempotencyKey, ...payload } = envelope.data;
    // O provedor manda o correlationId quando tem um; sem ele, o próprio messageId serve de rastro.
    const correlationId = envelope.correlationId ?? envelope.messageId;

    try {
      const result = await this.submitTransaction.execute({
        idempotencyKey,
        correlationId,
        payload,
        inbox: { consumerName: CONSUMER_NAME, messageId: envelope.messageId },
      });

      // Commitado: só agora a mensagem pode sair da fila.
      await this.queue.ack(message);

      this.logger.log({
        msg: 'Mensagem processada',
        correlationId,
        messageId: envelope.messageId,
        transactionId: result.transaction.id,
        walletId: payload.walletId,
        providerId: payload.providerId,
        status: result.transaction.status,
        idempotentReplay: result.idempotentReplay,
      });
    } catch (error) {
      await this.onFailure(message, envelope, correlationId, error);
    }
  }

  /**
   * Três destinos. Erro de negócio é terminal: reentregar daria exatamente a mesma recusa, então a
   * mensagem sai da fila com o motivo registrado. Erro transitório volta com espera crescente.
   * Esgotadas as tentativas, vai para a DLQ em vez de circular para sempre.
   */
  private async onFailure(
    message: IncomingMessage,
    envelope: WagerMessage,
    correlationId: string,
    error: unknown,
  ): Promise<void> {
    const context = {
      correlationId,
      messageId: envelope.messageId,
      walletId: envelope.data.walletId,
      providerId: envelope.data.providerId,
    };

    if (error instanceof DomainError) {
      this.logger.warn({
        ...context,
        msg: 'Mensagem recusada',
        failureCode: error.failureCode,
        reason: error.message,
      });
      await this.queue.ack(message);

      return;
    }

    const reason = (error as Error).message;

    if (message.receiveCount >= MAX_RECEIVES) {
      await this.discard(message, 'max_receives', reason, context);
      return;
    }

    const delay = retryDelaySeconds(message.receiveCount);

    this.metrics.retryScheduled('queue');
    this.logger.warn({
      ...context,
      msg: 'Mensagem falhou, nova tentativa agendada',
      attempt: message.receiveCount,
      retryInSeconds: delay,
      reason,
    });

    await this.queue.retryLater(message, delay);
  }

  private async discard(
    message: IncomingMessage,
    cause: DeadLetterCause,
    reason: string,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    this.metrics.messageDeadLettered(cause);
    this.logger.error({
      ...context,
      msg: 'Mensagem enviada para a DLQ',
      id: message.id,
      cause,
      reason,
    });

    await this.queue.deadLetter(message);
    await this.queue.ack(message);
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        // A leitura já segura a chamada enquanto a fila está vazia: não precisa de espera extra.
        await this.consumeBatch();
      } catch (error) {
        this.logger.error({ msg: 'Leitura da fila falhou', reason: (error as Error).message });
        await this.wait(ERROR_DELAY_MS);
      }
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
