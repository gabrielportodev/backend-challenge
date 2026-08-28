import type { LedgerPage } from '@application/ports';
import type { SubmitWagerTransactionResult } from '@application/wagering/submit-wager-transaction.use-case';
import type { ReconciliationReport } from '@application/wallet/reconcile-wallet.use-case';
import type { FailureCode } from '@domain/errors';
import type { MoneyProps } from '@domain/shared/money';
import type {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@domain/wagering/wager-transaction';
import type { Wallet } from '@domain/wallet/wallet';
import type { LedgerDirection, WalletLedgerEntry } from '@domain/wallet/wallet-ledger-entry';

export interface WalletResponse {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export function walletResponse(wallet: Wallet): WalletResponse {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

export interface LedgerEntryResponse {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerPageResponse {
  entries: LedgerEntryResponse[];
  nextCursor?: string;
}

export function ledgerPageResponse(page: LedgerPage): LedgerPageResponse {
  return { entries: page.entries.map(ledgerEntryResponse), nextCursor: page.nextCursor };
}

function ledgerEntryResponse(entry: WalletLedgerEntry): LedgerEntryResponse {
  return {
    id: entry.id,
    transactionId: entry.transactionId,
    direction: entry.direction,
    money: entry.money.toJSON(),
    balanceBefore: entry.balanceBefore.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    createdAt: entry.createdAt.toISOString(),
  };
}

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

export interface ReconciliationResponse {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export function reconciliationResponse(report: ReconciliationReport): ReconciliationResponse {
  return {
    walletId: report.walletId,
    storedBalance: report.storedBalance.toJSON(),
    calculatedBalance: report.calculatedBalance.toJSON(),
    difference: report.difference.toJSON(),
    consistent: report.consistent,
    checkedEntries: report.checkedEntries,
  };
}
