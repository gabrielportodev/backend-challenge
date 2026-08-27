import type { LedgerDirection } from '@domain/wallet/wallet-ledger-entry';
import { Check, Entity, Enum, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';

const DIRECTIONS: LedgerDirection[] = ['DEBIT', 'CREDIT'];

/**
 * Append-only: a migration bloqueia UPDATE e DELETE por trigger. Uma moeda só por
 * linha, porque valor, saldo anterior e saldo posterior são sempre da mesma wallet.
 */
@Entity({ tableName: 'wallet_ledger_entries' })
// No máximo um lançamento por wallet por transação: é o que impede o débito em dobro.
@Unique({
  name: 'wallet_ledger_entries_wallet_id_transaction_id_unique',
  properties: ['walletId', 'transactionId'],
})
@Check({ name: 'wallet_ledger_entries_amount_positive', expression: 'amount > 0' })
@Check({
  name: 'wallet_ledger_entries_balance_non_negative',
  expression: 'balance_before_amount >= 0 and balance_after_amount >= 0',
})
// Mesma conta do isBalanced do domínio, agora como constraint.
@Check({
  name: 'wallet_ledger_entries_balanced',
  expression:
    "balance_after_amount = case when direction = 'DEBIT' then balance_before_amount - amount else balance_before_amount + amount end",
})
// Índice do extrato paginado; o id entra para o cursor não empatar em createdAt igual.
@Index({
  name: 'wallet_ledger_entries_wallet_id_created_at_id_index',
  properties: ['walletId', 'createdAt', 'id'],
})
export class WalletLedgerEntryEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id!: string;

  @Property({ columnType: 'uuid' })
  walletId!: string;

  @Property({ columnType: 'uuid' })
  transactionId!: string;

  @Enum({ items: () => DIRECTIONS })
  direction!: LedgerDirection;

  @Property({ columnType: 'char(3)' })
  currency!: string;

  @Property({ columnType: 'numeric(19,2)' })
  amount!: string;

  @Property({ columnType: 'numeric(19,2)' })
  balanceBeforeAmount!: string;

  @Property({ columnType: 'numeric(19,2)' })
  balanceAfterAmount!: string;

  @Property({ columnType: 'timestamptz' })
  createdAt!: Date;
}
