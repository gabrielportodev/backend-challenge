import {
  INBOX_REPOSITORY,
  type InboxRepository,
} from '@modules/messaging/domain/inbox.repository.port';
import { InboxMessage } from '@modules/messaging/domain/inbox-message.entity';
import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import {
  WagerTransaction,
  type WagerTransactionKind,
} from '@modules/wagering/domain/wager-transaction.aggregate';
import {
  WAGER_TRANSACTION_REPOSITORY,
  type WagerTransactionRepository,
} from '@modules/wagering/domain/wager-transaction.repository.port';
import type { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '@modules/wallet/domain/wallet.repository.port';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError, walletNotFound } from '@shared/domain/errors';
import { Money, type MoneyProps } from '@shared/domain/money';
import { DuplicateTransactionError } from '@shared/kernel/duplicate-transaction.error';
import { newId } from '@shared/kernel/id';
import { hashPayload } from '@shared/kernel/payload-hash';
import { TRANSACTION_RUNNER, type TransactionRunner } from '@shared/kernel/transaction-runner.port';

/** Os campos de negócio: é sobre eles que o hash é calculado, sem header nem transporte. */
export interface WagerTransactionPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

/** Presente só quando a origem é a fila; o registro entra na mesma transação do dado financeiro. */
export interface InboxSource {
  consumerName: string;
  messageId: string;
}

export interface SubmitWagerTransactionCommand {
  idempotencyKey: string;
  correlationId: string;
  payload: WagerTransactionPayload;
  inbox?: InboxSource;
}

export interface SubmitWagerTransactionResult {
  transaction: WagerTransaction;
  /** Saldo observado agora: no replay é o atual, não o do processamento original. */
  wallet: Wallet;
  idempotentReplay: boolean;
}

/**
 * O caminho único de HTTP e da fila. Tudo — inbox, transação, saldo, ledger e evento — commita
 * junto, na ordem fixa: inbox, insert da transação, lock da wallet, validações, ledger, saldo,
 * outbox. O insert vem antes do lock de propósito: duplicata colide no unique sem entrar na fila
 * do lock.
 */
@Injectable()
export class SubmitWagerTransactionUseCase {
  constructor(
    @Inject(TRANSACTION_RUNNER) private readonly transaction: TransactionRunner,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
    @Inject(INBOX_REPOSITORY) private readonly inbox: InboxRepository,
    @Inject(WagerSettlement) private readonly settlement: WagerSettlement,
  ) {}

  async execute(command: SubmitWagerTransactionCommand): Promise<SubmitWagerTransactionResult> {
    const { payload } = command;

    WagerTransaction.assertExternallySubmittable(payload.kind);

    const money = Money.fromPositive(payload.money);
    // O valor entra no hash já normalizado em duas casas: "25.0" e "25.00" são o mesmo pedido.
    const payloadHash = hashPayload({ ...payload, money: money.toJSON() });

    try {
      return await this.transaction.run(() => this.process(command, money, payloadHash));
    } catch (error) {
      if (error instanceof DuplicateTransactionError) {
        return await this.resolveDuplicate(command, payloadHash, error);
      }

      throw error;
    }
  }

  private async process(
    command: SubmitWagerTransactionCommand,
    money: Money,
    payloadHash: string,
  ): Promise<SubmitWagerTransactionResult> {
    const now = new Date();
    const received = await this.receiveFromQueue(command, payloadHash, now);

    const transaction = WagerTransaction.create({
      ...command.payload,
      id: newId(),
      idempotencyKey: command.idempotencyKey,
      payloadHash,
      money,
      createdAt: now,
    });

    await this.transactions.insert(transaction);

    const wallet = await this.wallets.findByIdForUpdate(transaction.walletId);

    if (!wallet) {
      throw walletNotFound(transaction.walletId);
    }

    const entry = await this.settlement.settle(transaction, wallet, now);

    await this.transactions.update(transaction);
    await this.settlement.publish(transaction, wallet, entry, command.correlationId, now);

    if (received) {
      received.markProcessed(now);
      await this.inbox.update(received);
    }

    return { transaction, wallet, idempotentReplay: false };
  }

  private async receiveFromQueue(
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
    now: Date,
  ): Promise<InboxMessage | undefined> {
    if (!command.inbox) {
      return undefined;
    }

    const message = InboxMessage.receive({
      messageId: command.inbox.messageId,
      consumerName: command.inbox.consumerName,
      payloadHash,
      receivedAt: now,
    });

    await this.inbox.insert(message);

    return message;
  }

  /**
   * A escrita colidiu com algo já commitado. Mesma chave e mesmo payload é replay; mesma chave
   * com payload diferente é conflito, porque devolver "sucesso" afirmaria algo que não aconteceu.
   */
  private async resolveDuplicate(
    command: SubmitWagerTransactionCommand,
    payloadHash: string,
    cause: DuplicateTransactionError,
  ): Promise<SubmitWagerTransactionResult> {
    const { providerId, externalTransactionId } = command.payload;
    const existing = await this.transactions.findByIdempotencyKey(
      providerId,
      command.idempotencyKey,
    );

    if (existing) {
      if (!existing.matchesPayload(payloadHash)) {
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          `Chave ${command.idempotencyKey} já foi usada com outro payload`,
          { providerId, idempotencyKey: command.idempotencyKey },
        );
      }

      const wallet = await this.wallets.findById(existing.walletId);

      if (!wallet) {
        throw walletNotFound(existing.walletId);
      }

      return { transaction: existing, wallet, idempotentReplay: true };
    }

    // A chave é nova, então quem colidiu foi o externalTransactionId sob outra chave.
    if (await this.transactions.findByExternalId(providerId, externalTransactionId)) {
      throw new DomainError(
        'EXTERNAL_TRANSACTION_CONFLICT',
        `Transação ${externalTransactionId} já existe com outra chave de idempotência`,
        { providerId, externalTransactionId },
      );
    }

    throw cause;
  }
}
