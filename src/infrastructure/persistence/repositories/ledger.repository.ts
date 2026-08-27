import type { LedgerPage, LedgerRepository } from '@application/ports';
import { Money } from '@domain/shared/money';
import type { WalletLedgerEntry } from '@domain/wallet/wallet-ledger-entry';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { WalletLedgerEntryEntity } from '../entities';
import { ledgerEntryToDomain, ledgerEntryToEntity } from '../mappers';
import { decodeLedgerCursor, encodeLedgerCursor } from './ledger-cursor';

@Injectable()
export class MikroLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async append(entry: WalletLedgerEntry): Promise<void> {
    await this.em.insert(WalletLedgerEntryEntity, ledgerEntryToEntity(entry));
  }

  /** Busca uma linha a mais que o pedido: é assim que dá para saber se ainda existe página. */
  async listByWallet(walletId: string, limit: number, cursor?: string): Promise<LedgerPage> {
    const qb = this.em
      .createQueryBuilder(WalletLedgerEntryEntity, 'l')
      .select('*')
      .where({ walletId })
      .orderBy({ createdAt: 'asc', id: 'asc' })
      .limit(limit + 1);

    if (cursor) {
      const position = decodeLedgerCursor(cursor);

      qb.andWhere('("l"."created_at", "l"."id") > (?, ?)', [position.createdAt, position.id]);
    }

    const rows = await qb.getResultList();
    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      entries: page.map(ledgerEntryToDomain),
      nextCursor: rows.length > limit && last ? encodeLedgerCursor(last) : undefined,
    };
  }

  /** Soma no banco em vez de carregar o extrato: a wallet pode ter milhões de lançamentos. */
  async computeBalance(walletId: string, currency: string): Promise<Money> {
    const rows = await this.em.execute<{ total: string }[]>(
      `select coalesce(sum(case when direction = 'DEBIT' then -amount else amount end), 0)::numeric(19,2)::text as total
         from wallet_ledger_entries
        where wallet_id = ?`,
      [walletId],
    );

    return Money.from({ amount: rows[0]?.total ?? '0.00', currency });
  }
}
