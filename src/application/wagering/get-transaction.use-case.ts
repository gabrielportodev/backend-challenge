import { WAGER_TRANSACTION_REPOSITORY, type WagerTransactionRepository } from '@application/ports';
import { DomainError } from '@domain/errors';
import type { WagerTransaction } from '@domain/wagering/wager-transaction';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetTransactionUseCase {
  constructor(
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
  ) {}

  async byId(transactionId: string): Promise<WagerTransaction> {
    const transaction = await this.transactions.findById(transactionId);

    if (!transaction) {
      throw new DomainError('TRANSACTION_NOT_FOUND', `Transação não encontrada: ${transactionId}`, {
        transactionId,
      });
    }

    return transaction;
  }

  /** O caminho que o provedor usa: ele conhece o próprio id, não o nosso. */
  async byExternalId(providerId: string, externalTransactionId: string): Promise<WagerTransaction> {
    const transaction = await this.transactions.findByExternalId(providerId, externalTransactionId);

    if (!transaction) {
      throw new DomainError(
        'TRANSACTION_NOT_FOUND',
        `Transação não encontrada: ${providerId}/${externalTransactionId}`,
        { providerId, externalTransactionId },
      );
    }

    return transaction;
  }
}
