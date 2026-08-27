import type { WagerTransactionRepository } from '@application/ports';
import type { WagerTransaction } from '@domain/wagering/wager-transaction';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { WagerTransactionEntity } from '../entities';
import { transactionToDomain, transactionToEntity } from '../mappers';

@Injectable()
export class MikroWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

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

  /**
   * Insere na hora, sem esperar o flush do fim da transação: é esta escrita que colide no
   * unique `(provider_id, idempotency_key)` e barra a duplicata antes de qualquer lock.
   */
  async insert(transaction: WagerTransaction): Promise<void> {
    await this.em.insert(WagerTransactionEntity, transactionToEntity(transaction));
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
