import type { LedgerPage } from '@modules/wallet/domain/ledger.repository.port';
import type { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import type {
  LedgerDirection,
  WalletLedgerEntry,
} from '@modules/wallet/domain/wallet-ledger-entry.entity';
import type { MoneyProps } from '@shared/domain/money';

export interface WalletResponse {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export function walletResponse(wallet: Wallet): WalletResponse {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
  };
}

export interface LedgerEntryResponse {
  id: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerPageResponse {
  entries: LedgerEntryResponse[];
  nextCursor?: string;
}

export function ledgerPageResponse(page: LedgerPage): LedgerPageResponse {
  return { entries: page.entries.map(ledgerEntryResponse), nextCursor: page.nextCursor };
}

function ledgerEntryResponse(entry: WalletLedgerEntry): LedgerEntryResponse {
  return {
    id: entry.id,
    transactionId: entry.transactionId,
    direction: entry.direction,
    money: entry.money.toJSON(),
    balanceBefore: entry.balanceBefore.toJSON(),
    balanceAfter: entry.balanceAfter.toJSON(),
    createdAt: entry.createdAt.toISOString(),
  };
}
