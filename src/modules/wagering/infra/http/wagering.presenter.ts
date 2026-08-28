import type { SubmitWagerTransactionResult } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import type {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@modules/wagering/domain/wager-transaction.aggregate';
import type { FailureCode } from '@shared/domain/errors';
import type { MoneyProps } from '@shared/domain/money';

export interface TransactionResponse {
  id: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  status: WagerTransactionStatus;
  failureCode?: FailureCode;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  createdAt: string;
  processedAt?: string;
}

export function transactionResponse(transaction: WagerTransaction): TransactionResponse {
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    playerId: transaction.playerId,
    walletId: transaction.walletId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    status: transaction.status,
    failureCode: transaction.failureCode,
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    referenceTransactionId: transaction.referenceTransactionId,
    createdAt: transaction.createdAt.toISOString(),
    processedAt: transaction.processedAt?.toISOString(),
  };
}

export interface SubmissionResponse {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

/** No replay o saldo é o observado agora, não o do processamento original. */
export function submissionResponse(result: SubmitWagerTransactionResult): SubmissionResponse {
  return {
    transactionId: result.transaction.id,
    status: result.transaction.status,
    balance: result.wallet.balance.toJSON(),
    idempotentReplay: result.idempotentReplay,
    failureCode: result.transaction.failureCode,
  };
}
