import { Wallet } from '@domain/wallet/wallet';
import { WalletEntity } from '../entities/wallet.entity';

/**
 * Converte a linha da tabela no agregado e de volta. É aqui que a coluna `currency`
 * da linha se junta a cada `*_amount` para formar um `Money`.
 */
export function walletToDomain(row: WalletEntity): Wallet {
  return Wallet.rehydrate({
    id: row.id,
    playerId: row.playerId,
    currency: row.currency,
    balance: { amount: row.balanceAmount, currency: row.currency },
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function walletToEntity(wallet: Wallet): WalletEntity {
  const row = new WalletEntity();

  row.id = wallet.id;
  row.playerId = wallet.playerId;
  row.currency = wallet.currency;
  row.balanceAmount = wallet.balance.toString();
  row.version = wallet.version;
  row.createdAt = wallet.createdAt;
  row.updatedAt = wallet.updatedAt;

  return row;
}
