import type { Money } from '@domain/shared/money';
import type { WalletLedgerEntry } from '@domain/wallet/wallet-ledger-entry';

export const LEDGER_REPOSITORY = 'LedgerRepository';

export interface LedgerPage {
  entries: WalletLedgerEntry[];
  /** Ausente quando não há mais página. */
  nextCursor?: string;
}

/** O que a reconciliação precisa saber sobre o ledger de uma wallet. */
export interface LedgerSummary {
  balance: Money;
  entries: number;
}

export interface LedgerRepository {
  /** Só insere: o ledger é append-only, não existe update nem delete. */
  append(entry: WalletLedgerEntry): Promise<void>;

  /** Extrato paginado por cursor opaco; a ordem é estável mesmo com inserts concorrentes. */
  listByWallet(walletId: string, limit: number, cursor?: string): Promise<LedgerPage>;

  /** Reconstrói o saldo somando o ledger inteiro: tem que bater com o saldo gravado na wallet. */
  summarize(walletId: string, currency: string): Promise<LedgerSummary>;
}
