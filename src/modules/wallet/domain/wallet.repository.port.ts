import type { Wallet } from './wallet.aggregate';

export const WALLET_REPOSITORY = 'WalletRepository';

export interface WalletRepository {
  findById(id: string): Promise<Wallet | null>;

  /**
   * Carrega travando a linha com SELECT ... FOR UPDATE. Só funciona dentro de uma transação
   * e é o único caminho permitido antes de mexer no saldo.
   */
  findByIdForUpdate(id: string): Promise<Wallet | null>;

  insert(wallet: Wallet): Promise<void>;

  /**
   * Grava o saldo com `version = expectedVersion` no WHERE. Se nenhuma linha for afetada,
   * alguém mexeu na wallet sem passar pelo lock: falha em vez de sobrescrever.
   */
  update(wallet: Wallet, expectedVersion: number): Promise<void>;
}
