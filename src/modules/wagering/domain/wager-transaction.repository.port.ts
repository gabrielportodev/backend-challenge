import type { WagerTransaction, WagerTransactionKind } from './wager-transaction.aggregate';

export const WAGER_TRANSACTION_REPOSITORY = 'WagerTransactionRepository';

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;

  /** Caminho da idempotência: é esta busca que reconhece um replay. */
  findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null>;

  /** Caminho da referência de REFUND e ROLLBACK, e da consulta pública por transação. */
  findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null>;

  /**
   * Fila do worker que reprocessa quem chegou antes da referência, da mais antiga para a mais
   * nova, já travada para esta instância. Precisa rodar dentro de uma transação.
   */
  findPendingReferenceDue(limit: number, now: Date): Promise<WagerTransaction[]>;

  /**
   * Reversão do mesmo tipo já aplicada sobre a referência. O índice parcial no banco é a
   * garantia; esta busca existe para responder com uma rejeição em vez de estourar a transação.
   */
  findReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null>;

  /** Colide quando a chave de idempotência ou o externalTransactionId já foram usados. */
  insert(transaction: WagerTransaction): Promise<void>;

  update(transaction: WagerTransaction): Promise<void>;
}
