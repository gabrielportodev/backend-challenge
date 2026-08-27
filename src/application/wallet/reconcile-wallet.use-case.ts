import {
  LEDGER_REPOSITORY,
  type LedgerRepository,
  TRANSACTION_RUNNER,
  type TransactionRunner,
  WALLET_REPOSITORY,
  type WalletRepository,
} from '@application/ports';
import { walletNotFound } from '@domain/errors';
import type { Money } from '@domain/shared/money';
import { Inject, Injectable, Logger } from '@nestjs/common';

export interface ReconciliationReport {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class ReconcileWalletUseCase {
  private readonly logger = new Logger(ReconcileWalletUseCase.name);

  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
  ) {}

  /**
   * Roda sob o lock da wallet. Sem ele, uma transação que commitasse entre a leitura do saldo e a
   * soma do ledger apareceria como divergência que nunca existiu.
   */
  async execute(walletId: string): Promise<ReconciliationReport> {
    const report = await this.transaction.run(async () => {
      const wallet = await this.wallets.findByIdForUpdate(walletId);

      if (!wallet) {
        throw walletNotFound(walletId);
      }

      const ledger = await this.ledger.summarize(walletId, wallet.currency);

      return {
        walletId,
        storedBalance: wallet.balance,
        calculatedBalance: ledger.balance,
        difference: wallet.balance.subtract(ledger.balance),
        consistent: wallet.balance.equals(ledger.balance),
        checkedEntries: ledger.entries,
      };
    });

    // Divergência não é corrigida em silêncio: fica no log e sinalizada na resposta.
    if (!report.consistent) {
      this.logger.error(
        `Divergência na wallet ${walletId}: saldo ${report.storedBalance.toString()}, ` +
          `ledger ${report.calculatedBalance.toString()}, diferença ${report.difference.toString()}`,
      );
    }

    return report;
  }
}
