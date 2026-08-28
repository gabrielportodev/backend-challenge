import { DomainError, type FailureCode } from '@shared/domain/errors';
import type { MoneyProps } from '@shared/domain/money';
import { type EventContext, IntegrationEvent } from '@shared/kernel/integration-event';
import type { WagerTransaction, WagerTransactionKind } from './wager-transaction.aggregate';

interface WagerTransactionData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
}

export interface WagerTransactionProcessedData extends WagerTransactionData {
  referenceExternalTransactionId?: string;
}

export interface WagerTransactionRejectedData extends WagerTransactionData {
  failureCode: FailureCode;
}

export interface WagerTransactionPendingReferenceData extends WagerTransactionData {
  referenceExternalTransactionId: string;
}

/** Campos que os três eventos de transação têm em comum. */
function baseData(transaction: WagerTransaction): WagerTransactionData {
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
  };
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      ...ctx,
      aggregateId: transaction.id,
      data: {
        ...baseData(transaction),
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      },
    });
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionRejected {
    if (!transaction.failureCode) {
      throw new DomainError(
        'INVALID_TRANSACTION_STATE',
        'Rejeição sem failureCode não vira evento',
        {
          transactionId: transaction.id,
          status: transaction.status,
        },
      );
    }

    return new WagerTransactionRejected({
      ...ctx,
      aggregateId: transaction.id,
      data: { ...baseData(transaction), failureCode: transaction.failureCode },
    });
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(transaction: WagerTransaction, ctx: EventContext): WagerTransactionPendingReference {
    if (!transaction.referenceExternalTransactionId) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Pendência de referência exige a referência buscada',
        {
          transactionId: transaction.id,
          kind: transaction.kind,
        },
      );
    }

    return new WagerTransactionPendingReference({
      ...ctx,
      aggregateId: transaction.id,
      data: {
        ...baseData(transaction),
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      },
    });
  }
}
