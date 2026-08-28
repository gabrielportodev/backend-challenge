import { EntityManager } from '@mikro-orm/postgresql';
import type {
  WagerTransaction,
  WagerTransactionKind,
} from '@modules/wagering/domain/wager-transaction.aggregate';
import type { WagerTransactionRepository } from '@modules/wagering/domain/wager-transaction.repository.port';
import { Inject, Injectable } from '@nestjs/common';
import { walletNotFound } from '@shared/domain/errors';
import { isForeignKeyViolation, isUniqueViolation } from '@shared/infra/persistence/database-error';
import { DuplicateTransactionError } from '@shared/kernel/duplicate-transaction.error';
import { transactionToDomain, transactionToEntity } from './wager-transaction.mapper';
import { WagerTransactionEntity } from './wager-transaction.mikro-entity';

@Injectable()
export class MikroWagerTransactionRepository implements WagerTransactionRepository {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, { id });

    return row ? transactionToDomain(row) : null;
  }

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, { providerId, idempotencyKey });

    return row ? transactionToDomain(row) : null;
  }

  async findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });

    return row ? transactionToDomain(row) : null;
  }

  async findPendingReference(limit: number): Promise<WagerTransaction[]> {
    const rows = await this.em.find(
      WagerTransactionEntity,
      { status: 'PENDING_REFERENCE' },
      { orderBy: { createdAt: 'asc' }, limit },
    );

    return rows.map(transactionToDomain);
  }

  async findReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    const row = await this.em.findOne(WagerTransactionEntity, {
      referenceTransactionId,
      kind,
      status: 'PROCESSED',
    });

    return row ? transactionToDomain(row) : null;
  }

  /**
   * Insere na hora, sem esperar o flush do fim da transação: é esta escrita que colide no
   * unique `(provider_id, idempotency_key)` e barra a duplicata antes de qualquer lock.
   *
   * A FK de `wallet_id` também é checada aqui, então wallet inexistente aparece como rejeição
   * de negócio em vez de erro de driver — e sem custar uma consulta a mais no caminho feliz.
   */
  async insert(transaction: WagerTransaction): Promise<void> {
    try {
      await this.em.insert(WagerTransactionEntity, transactionToEntity(transaction));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateTransactionError('wager_transactions');
      }

      if (isForeignKeyViolation(error)) {
        throw walletNotFound(transaction.walletId);
      }

      throw error;
    }
  }

  async update(transaction: WagerTransaction): Promise<void> {
    await this.em.nativeUpdate(
      WagerTransactionEntity,
      { id: transaction.id },
      {
        status: transaction.status,
        referenceTransactionId: transaction.referenceTransactionId,
        failureCode: transaction.failureCode,
        processedAt: transaction.processedAt,
      },
    );
  }
}
