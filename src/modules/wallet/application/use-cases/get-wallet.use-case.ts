import type { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '@modules/wallet/domain/wallet.repository.port';
import { Inject, Injectable } from '@nestjs/common';
import { walletNotFound } from '@shared/domain/errors';

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
