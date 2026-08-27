import { WagerTransaction } from '@domain/wagering/wager-transaction';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

export function transactionToDomain(row: WagerTransactionEntity): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: row.id,
    providerId: row.providerId,
    externalTransactionId: row.externalTransactionId,
    idempotencyKey: row.idempotencyKey,
    payloadHash: row.payloadHash,
    walletId: row.walletId,
    playerId: row.playerId,
    roundId: row.roundId,
    gameId: row.gameId,
    kind: row.kind,
    money: { amount: row.amount, currency: row.currency },
    referenceExternalTransactionId: row.referenceExternalTransactionId,
    createdAt: row.createdAt,
    status: row.status,
    referenceTransactionId: row.referenceTransactionId,
    failureCode: row.failureCode,
    processedAt: row.processedAt,
  });
}

export function transactionToEntity(transaction: WagerTransaction): WagerTransactionEntity {
  const row = new WagerTransactionEntity();

  row.id = transaction.id;
  row.providerId = transaction.providerId;
  row.externalTransactionId = transaction.externalTransactionId;
  row.idempotencyKey = transaction.idempotencyKey;
  row.payloadHash = transaction.payloadHash;
  row.walletId = transaction.walletId;
  row.playerId = transaction.playerId;
  row.roundId = transaction.roundId;
  row.gameId = transaction.gameId;
  row.kind = transaction.kind;
  row.amount = transaction.money.toString();
  row.currency = transaction.money.currency;
  row.referenceExternalTransactionId = transaction.referenceExternalTransactionId;
  row.referenceTransactionId = transaction.referenceTransactionId;
  row.status = transaction.status;
  row.failureCode = transaction.failureCode;
  row.createdAt = transaction.createdAt;
  row.processedAt = transaction.processedAt;

  return row;
}
