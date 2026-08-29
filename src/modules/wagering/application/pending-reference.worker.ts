import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import type { WagerTransaction } from '@modules/wagering/domain/wager-transaction.aggregate';
import {
  WAGER_TRANSACTION_REPOSITORY,
  type WagerTransactionRepository,
} from '@modules/wagering/domain/wager-transaction.repository.port';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '@modules/wallet/domain/wallet.repository.port';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { walletNotFound } from '@shared/domain/errors';
import { MetricsService } from '@shared/infra/metrics/metrics.service';
import { TRANSACTION_RUNNER, type TransactionRunner } from '@shared/kernel/transaction-runner.port';

const BATCH_SIZE = 10;
/** Espera entre as varreduras. Menor que o backoff mínimo de 30s, para não atrasar a fila. */
const IDLE_DELAY_MS = 10_000;
const ERROR_DELAY_MS = 30_000;

/**
 * Reprocessa as transações que chegaram antes da referência. Roda em todas as instâncias e usa
 * `SKIP LOCKED`, então cada uma pega um lote diferente.
 *
 * Nada aqui reimplementa regra: quem decide o destino continua sendo o `WagerSettlement`, o mesmo
 * do caminho de submissão. O worker só escolhe quem tentar de novo e quando desistir.
 */
@Injectable()
export class PendingReferenceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private running = false;
  private loop?: Promise<void>;
  /** Interrompe a espera entre varreduras, para o shutdown não ficar preso no `setTimeout`. */
  private wakeUp?: () => void;

  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WagerSettlement) private readonly settlement: WagerSettlement,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.wakeUp?.();

    await this.loop;
  }

  /** Uma varredura: pega o lote vencido, já travado, e tenta resolver cada transação. */
  async resolveDue(now = new Date()): Promise<number> {
    const settled: WagerTransaction[] = [];

    const total = await this.transaction.run(async () => {
      const due = await this.transactions.findPendingReferenceDue(BATCH_SIZE, now);

      for (const transaction of due) {
        if (await this.resolveOne(transaction, now)) {
          settled.push(transaction);
        }
      }

      return due.length;
    });

    // Contadas depois do commit: o que um rollback desfizesse não pode aparecer como concluído.
    for (const transaction of settled) {
      this.metrics.transactionSettled(transaction.kind, transaction.status);
    }

    return total;
  }

  /** Devolve `true` quando a transação chegou a um estado terminal nesta tentativa. */
  private async resolveOne(transaction: WagerTransaction, now: Date): Promise<boolean> {
    // Mesma ordem de locks do caminho de submissão — transação e depois wallet — para não
    // inverter a fila e criar deadlock entre o worker e uma aposta chegando pela borda.
    const wallet = await this.wallets.findByIdForUpdate(transaction.walletId);

    if (!wallet) {
      throw walletNotFound(transaction.walletId);
    }

    const entry = await this.settlement.settle(transaction, wallet, now);

    // A referência ainda não chegou: o settle já reagendou a próxima tentativa.
    if (transaction.status === 'PENDING_REFERENCE') {
      if (transaction.hasExhaustedReferenceRetries()) {
        transaction.reject('REFERENCE_NOT_FOUND');
      } else {
        await this.transactions.update(transaction);
        return false;
      }
    }

    await this.transactions.update(transaction);
    // O evento só sai quando a transação chega a um estado terminal: reagendamento não é notícia.
    await this.settlement.publish(transaction, wallet, entry, transaction.id, now);

    this.logger.log({
      msg: 'Transação saiu de PENDING_REFERENCE',
      // O mesmo correlationId que o evento publicado carrega: o log e o evento se encontram.
      correlationId: transaction.id,
      transactionId: transaction.id,
      walletId: transaction.walletId,
      providerId: transaction.providerId,
      status: transaction.status,
      failureCode: transaction.failureCode,
    });

    return true;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let delay = IDLE_DELAY_MS;

      try {
        await this.resolveDue();
      } catch (error) {
        this.logger.error({
          msg: 'Varredura de PENDING_REFERENCE falhou',
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
