import { WALLET_REPOSITORY, type WalletRepository } from '@application/ports';
import { walletNotFound } from '@domain/errors';
import type { Wallet } from '@domain/wallet/wallet';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetWalletUseCase {
  constructor(@Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository) {}

  async execute(walletId: string): Promise<Wallet> {
    const wallet = await this.wallets.findById(walletId);

    if (!wallet) {
      throw walletNotFound(walletId);
    }

    return wallet;
  }
}
