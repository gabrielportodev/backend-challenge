import { EntityManager, LockMode } from '@mikro-orm/postgresql';
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
   * SELECT ... FOR UPDATE. O MikroORM recusa lock pessimista fora de transação, então
   * chamar isto sem `TransactionRunner.run` falha na hora em vez de ler sem proteção.
   */
  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    const row = await this.em.findOne(
      WalletEntity,
      { id },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );

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
