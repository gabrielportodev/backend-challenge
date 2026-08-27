import {
  LEDGER_REPOSITORY,
  type LedgerRepository,
  OUTBOX_REPOSITORY,
  type OutboxRepository,
  TRANSACTION_RUNNER,
  type TransactionRunner,
  WAGER_TRANSACTION_REPOSITORY,
  WALLET_REPOSITORY,
  type WagerTransactionRepository,
  type WalletRepository,
} from '@application/ports';
import { WalletBalanceChanged } from '@domain/events';
import { OutboxMessage } from '@domain/messaging';
import { Money, type MoneyProps } from '@domain/shared/money';
import { WagerTransaction } from '@domain/wagering/wager-transaction';
import { Wallet } from '@domain/wallet/wallet';
import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@shared/id';
import { hashPayload } from '@shared/payload-hash';

// A abertura é interna: não vem de provedor, rodada nem jogo. Estes marcadores preenchem as
// colunas obrigatórias da transação sem se passar por um envio externo.
const INTERNAL_PROVIDER_ID = 'system';
const INTERNAL_MARKER = 'wallet-opening';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
  correlationId: string;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Wallet, transação de abertura, lançamento e evento commitam juntos. Saldo inicial zero não
   * é movimentação: cria só a wallet, sem transação e sem ledger.
   *
   * Wallet duplicada não é checada antes: quem decide é o unique (player_id, currency), então
   * duas criações simultâneas para o mesmo player não conseguem passar as duas.
   */
  async execute(command: CreateWalletCommand): Promise<Wallet> {
    const openedAt = new Date();
    const openingTransactionId = newId();

    const { wallet, openingEntry } = Wallet.open({
      id: newId(),
      playerId: command.playerId,
      initialBalance: Money.from(command.initialBalance),
      openedAt,
      openingTransactionId,
      openingLedgerEntryId: newId(),
    });

    await this.transaction.run(async () => {
      // A wallet vem primeiro: a transação de abertura e o lançamento têm FK para ela.
      await this.wallets.insert(wallet);

      if (!openingEntry) {
        return;
      }

      const opening = this.openingTransaction(wallet, openingTransactionId, openedAt);
      opening.markProcessed(undefined, openedAt);

      await this.transactions.insert(opening);
      await this.ledger.append(openingEntry);

      const event = WalletBalanceChanged.from(wallet, openingEntry, {
        eventId: newId(),
        correlationId: command.correlationId,
        causationId: opening.id,
        occurredAt: openedAt,
      });

      await this.outbox.enqueue(OutboxMessage.enqueue(event));
    });

    return wallet;
  }

  private openingTransaction(wallet: Wallet, id: string, at: Date): WagerTransaction {
    return WagerTransaction.create({
      id,
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId: id,
      // Uma abertura por wallet: uma segunda tentativa colide no unique da chave de idempotência.
      idempotencyKey: `${INTERNAL_MARKER}:${wallet.id}`,
      payloadHash: hashPayload({
        kind: 'OPENING',
        walletId: wallet.id,
        playerId: wallet.playerId,
        money: wallet.balance.toJSON(),
      }),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: INTERNAL_MARKER,
      gameId: INTERNAL_MARKER,
      kind: 'OPENING',
      money: wallet.balance,
      createdAt: at,
    });
  }
}
