import { WagerTransaction } from '@modules/wagering/domain/wager-transaction.aggregate';
import { WagerTransactionEntity } from './wager-transaction.mikro-entity';

// A coluna nula chega como null, e o domínio trabalha com undefined: a troca acontece aqui, uma vez.
const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

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
    referenceExternalTransactionId: orUndefined(row.referenceExternalTransactionId),
    createdAt: row.createdAt,
    status: row.status,
    referenceTransactionId: orUndefined(row.referenceTransactionId),
    failureCode: orUndefined(row.failureCode),
    processedAt: orUndefined(row.processedAt),
    referenceAttempts: row.referenceAttempts,
    nextReferenceAttemptAt: orUndefined(row.nextReferenceAttemptAt),
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
  row.referenceAttempts = transaction.referenceAttempts;
  row.nextReferenceAttemptAt = transaction.nextReferenceAttemptAt;

  return row;
}
