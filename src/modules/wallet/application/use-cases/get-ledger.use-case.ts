import {
  LEDGER_REPOSITORY,
  type LedgerPage,
  type LedgerRepository,
} from '@modules/wallet/domain/ledger.repository.port';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '@modules/wallet/domain/wallet.repository.port';
import { Inject, Injectable } from '@nestjs/common';
import { walletNotFound } from '@shared/domain/errors';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface GetLedgerQuery {
  walletId: string;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class GetLedgerUseCase {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
  ) {}

  /**
   * Confere a wallet antes de paginar: sem isso, um id inexistente devolveria página vazia, que é
   * indistinguível de uma wallet sem lançamentos.
   */
  async execute(query: GetLedgerQuery): Promise<LedgerPage> {
    const wallet = await this.wallets.findById(query.walletId);

    if (!wallet) {
      throw walletNotFound(query.walletId);
    }

    return this.ledger.listByWallet(query.walletId, pageSize(query.limit), query.cursor);
  }
}

/** Limite fora da faixa é aparado, não recusado: paginação não é lugar de erro de validação. */
function pageSize(limit?: number): number {
  if (!limit || limit < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(limit, MAX_LIMIT);
}
