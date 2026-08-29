import { EntityManager } from '@mikro-orm/postgresql';
import type { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import type { WalletRepository } from '@modules/wallet/domain/wallet.repository.port';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@shared/domain/errors';
import {
  isUniqueViolation,
  StaleWalletVersionError,
} from '@shared/infra/persistence/database-error';
import { walletToDomain, walletToEntity } from './wallet.mapper';
import { WalletEntity } from './wallet.mikro-entity';

@Injectable()
export class MikroWalletRepository implements WalletRepository {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletEntity, { id });

    return row ? walletToDomain(row) : null;
  }

  /**
   * Trava a linha da wallet para esta transação. O lock é `FOR NO KEY UPDATE`, e não `FOR UPDATE`,
   * porque o que precisa ser excluído é outra escrita de saldo — a chave da linha não muda.
   *
   * O insert de `wager_transactions` toma `FOR KEY SHARE` na wallet por causa da FK, e
   * `FOR UPDATE` conflita com esse lock. Como o insert vem antes, duas submissões concorrentes na
   * mesma wallet fechariam um ciclo e o Postgres mataria uma por deadlock. `FOR NO KEY UPDATE`
   * convive com o `FOR KEY SHARE` e continua serializando as escritas de saldo.
   */
  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    // Fora de uma transação o lock seria liberado logo em seguida, sem proteger nada.
    if (!this.em.getTransactionContext()) {
      throw new Error('findByIdForUpdate precisa rodar dentro de TransactionRunner.run');
    }

    const locked = await this.em.execute<{ id: string }[]>(
      'select id from wallets where id = ? for no key update',
      [id],
    );

    if (locked.length === 0) {
      return null;
    }

    // `refresh` porque a leitura só vale depois do lock: o que estiver no identity map é anterior.
    const row = await this.em.findOne(WalletEntity, { id }, { refresh: true });

    return row ? walletToDomain(row) : null;
  }

  async insert(wallet: Wallet): Promise<void> {
    try {
      await this.em.insert(WalletEntity, walletToEntity(wallet));
    } catch (error) {
      // O unique (player_id, currency) é quem decide o vencedor entre duas criações concorrentes.
      if (isUniqueViolation(error)) {
        throw new DomainError(
          'WALLET_ALREADY_EXISTS',
          `Já existe wallet de ${wallet.currency} para o player ${wallet.playerId}`,
          { playerId: wallet.playerId, currency: wallet.currency },
        );
      }

      throw error;
    }
  }

  async update(wallet: Wallet, expectedVersion: number): Promise<void> {
    const affected = await this.em.nativeUpdate(
      WalletEntity,
      { id: wallet.id, version: expectedVersion },
      {
        balanceAmount: wallet.balance.toString(),
        version: wallet.version,
        updatedAt: wallet.updatedAt,
      },
    );

    if (affected !== 1) {
      throw new StaleWalletVersionError(wallet.id, expectedVersion);
    }
  }
}
