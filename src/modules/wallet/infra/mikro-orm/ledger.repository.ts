import { EntityManager } from '@mikro-orm/postgresql';
import type {
  LedgerPage,
  LedgerRepository,
  LedgerSummary,
} from '@modules/wallet/domain/ledger.repository.port';
import type { WalletLedgerEntry } from '@modules/wallet/domain/wallet-ledger-entry.entity';
import { Inject, Injectable } from '@nestjs/common';
import { Money } from '@shared/domain/money';
import { decodeLedgerCursor, encodeLedgerCursor } from './ledger-cursor';
import { ledgerEntryToDomain, ledgerEntryToEntity } from './wallet-ledger-entry.mapper';
import { WalletLedgerEntryEntity } from './wallet-ledger-entry.mikro-entity';

@Injectable()
export class MikroLedgerRepository implements LedgerRepository {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

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

  /** Soma e conta no banco, numa consulta só: a wallet pode ter milhões de lançamentos. */
  async summarize(walletId: string, currency: string): Promise<LedgerSummary> {
    const rows = await this.em.execute<{ total: string; entries: string }[]>(
      `select coalesce(sum(case when direction = 'DEBIT' then -amount else amount end), 0)::numeric(19,2)::text as total,
              count(*)::text as entries
         from wallet_ledger_entries
        where wallet_id = ?`,
      [walletId],
    );

    return {
      balance: Money.from({ amount: rows[0]?.total ?? '0.00', currency }),
      entries: Number(rows[0]?.entries ?? 0),
    };
  }
}
