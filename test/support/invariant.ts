import { expect } from 'bun:test';
import type { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import type { WalletLedgerEntry } from '@modules/wallet/domain/wallet-ledger-entry.entity';
import { Money } from '@shared/domain/money';
import type { Sql } from './app';

/**
 * A invariante que fecha todo teste: o saldo materializado tem que ser exatamente o que os
 * lançamentos reconstroem. Se ela vale, não houve débito perdido, duplicado nem meio aplicado.
 */
export function expectBalanceMatchesLedger(wallet: Wallet, entries: WalletLedgerEntry[]): void {
  const rebuilt = entries
    .filter((entry) => entry.walletId === wallet.id)
    .reduce(
      (total, entry) =>
        entry.direction === 'DEBIT' ? total.subtract(entry.money) : total.add(entry.money),
      Money.zero(wallet.currency),
    );

  expect(rebuilt.toString()).toBe(wallet.balance.toString());
}

interface BalanceRow {
  id: string;
  balance: string;
  ledger: string;
}

/**
 * A mesma invariante contra o banco, para todas as wallets de uma vez. A soma é feita em SQL,
 * então o que está sendo conferido são as linhas gravadas, não o cache do ORM.
 */
export async function expectStoredBalancesMatchLedger(sql: Sql): Promise<void> {
  const rows = await sql<BalanceRow>(`
    select w.id::text as id,
           w.balance_amount::text as balance,
           coalesce(
             sum(case when l.direction = 'DEBIT' then -l.amount else l.amount end),
             0
           )::numeric(19,2)::text as ledger
      from wallets w
      left join wallet_ledger_entries l on l.wallet_id = w.id
     group by w.id, w.balance_amount
  `);

  const divergentes = rows.filter((row) => row.balance !== row.ledger);

  expect(divergentes).toEqual([]);
}
