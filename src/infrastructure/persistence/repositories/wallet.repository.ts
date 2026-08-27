import type { WalletRepository } from '@application/ports';
import type { Wallet } from '@domain/wallet/wallet';
import { type EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { StaleWalletVersionError } from '../database-error';
import { WalletEntity } from '../entities';
import { walletToDomain, walletToEntity } from '../mappers';

@Injectable()
export class MikroWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletEntity, { id });

    return row ? walletToDomain(row) : null;
  }

  async findByPlayer(playerId: string, currency: string): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletEntity, { playerId, currency });

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
    await this.em.insert(WalletEntity, walletToEntity(wallet));
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
