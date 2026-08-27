import { WalletLedgerEntry } from '@domain/wallet/wallet-ledger-entry';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity';

export function ledgerEntryToDomain(row: WalletLedgerEntryEntity): WalletLedgerEntry {
  return WalletLedgerEntry.rehydrate({
    id: row.id,
    walletId: row.walletId,
    transactionId: row.transactionId,
    direction: row.direction,
    money: { amount: row.amount, currency: row.currency },
    balanceBefore: { amount: row.balanceBeforeAmount, currency: row.currency },
    balanceAfter: { amount: row.balanceAfterAmount, currency: row.currency },
    createdAt: row.createdAt,
  });
}

/** Sempre monta linha nova: o ledger é append-only, não existe caminho de update. */
export function ledgerEntryToEntity(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
  const row = new WalletLedgerEntryEntity();

  row.id = entry.id;
  row.walletId = entry.walletId;
  row.transactionId = entry.transactionId;
  row.direction = entry.direction;
  row.currency = entry.money.currency;
  row.amount = entry.money.toString();
  row.balanceBeforeAmount = entry.balanceBefore.toString();
  row.balanceAfterAmount = entry.balanceAfter.toString();
  row.createdAt = entry.createdAt;

  return row;
}
