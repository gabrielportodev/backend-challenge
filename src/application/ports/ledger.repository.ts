import type { Money } from '@domain/shared/money';
import type { WalletLedgerEntry } from '@domain/wallet/wallet-ledger-entry';

export const LEDGER_REPOSITORY = 'LedgerRepository';

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  /** Ausente quando não há mais página. */
  nextCursor?: string;
}

export interface LedgerRepository {
  /** Só insere: o ledger é append-only, não existe update nem delete. */
  append(entry: WalletLedgerEntry): Promise<void>;

  /** Extrato paginado por cursor opaco; a ordem é estável mesmo com inserts concorrentes. */
  listByWallet(walletId: string, limit: number, cursor?: string): Promise<LedgerPage>;

  /** Soma o ledger inteiro para a reconciliação: o resultado tem que bater com o saldo gravado. */
  computeBalance(walletId: string, currency: string): Promise<Money>;
}
