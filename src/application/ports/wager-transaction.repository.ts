import type { WagerTransaction } from '@domain/wagering/wager-transaction';

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

  /** Fila do worker que reprocessa quem chegou antes da referência, da mais antiga para a mais nova. */
  findPendingReference(limit: number): Promise<WagerTransaction[]>;

  insert(transaction: WagerTransaction): Promise<void>;

  update(transaction: WagerTransaction): Promise<void>;
}
