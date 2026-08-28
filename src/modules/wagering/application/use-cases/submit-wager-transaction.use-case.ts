import {
  INBOX_REPOSITORY,
  type InboxRepository,
} from '@modules/messaging/domain/inbox.repository.port';
import { InboxMessage } from '@modules/messaging/domain/inbox-message.entity';
import {
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from '@modules/messaging/domain/outbox.repository.port';
import { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import {
  WagerTransaction,
  type WagerTransactionKind,
} from '@modules/wagering/domain/wager-transaction.aggregate';
import {
  WAGER_TRANSACTION_REPOSITORY,
  type WagerTransactionRepository,
} from '@modules/wagering/domain/wager-transaction.repository.port';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '@modules/wagering/domain/wager-transaction-events';
import {
  LEDGER_REPOSITORY,
  type LedgerRepository,
} from '@modules/wallet/domain/ledger.repository.port';
import type { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '@modules/wallet/domain/wallet.repository.port';
import { WalletBalanceChanged } from '@modules/wallet/domain/wallet-events';
import type { WalletLedgerEntry } from '@modules/wallet/domain/wallet-ledger-entry.entity';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError, type FailureCode, walletNotFound } from '@shared/domain/errors';
import { Money, type MoneyProps } from '@shared/domain/money';
import { DuplicateTransactionError } from '@shared/kernel/duplicate-transaction.error';
import { newId } from '@shared/kernel/id';
import type { IntegrationEvent } from '@shared/kernel/integration-event';
import { hashPayload } from '@shared/kernel/payload-hash';
import { TRANSACTION_RUNNER, type TransactionRunner } from '@shared/kernel/transaction-runner.port';

const REFUNDABLE: WagerTransactionKind[] = ['BET'];
const ROLLBACKABLE: WagerTransactionKind[] = ['BET', 'WIN', 'REFUND'];

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

/**
 * O destino da referência de um REFUND ou ROLLBACK: seguir em frente (com a referência quando o
 * tipo exige uma), esperar a referência chegar, ou rejeitar por um motivo específico.
 */
type ReferenceOutcome =
  | { outcome: 'RESOLVED'; transaction?: WagerTransaction }
  | { outcome: 'AWAIT' }
  | { outcome: 'REJECT'; failureCode: FailureCode };

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
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(INBOX_REPOSITORY) private readonly inbox: InboxRepository,
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

    const entry = await this.settle(transaction, wallet, now);

    await this.transactions.update(transaction);
    await this.publish(transaction, wallet, entry, command.correlationId, now);

    if (received) {
      received.markProcessed(now);
      await this.inbox.update(received);
    }

    return { transaction, wallet, idempotentReplay: false };
  }

  /**
   * Decide o destino da transação e, quando há movimento, grava ledger e saldo. Devolve o
   * lançamento gerado, ou nada quando a transação não move saldo.
   */
  private async settle(
    transaction: WagerTransaction,
    wallet: Wallet,
    now: Date,
  ): Promise<WalletLedgerEntry | undefined> {
    const mismatch = this.walletMismatch(transaction, wallet);

    if (mismatch) {
      transaction.reject(mismatch);
      return undefined;
    }

    const reference = await this.resolveReference(transaction);

    if (reference.outcome === 'REJECT') {
      transaction.reject(reference.failureCode);
      return undefined;
    }

    if (reference.outcome === 'AWAIT') {
      transaction.markPendingReference();
      return undefined;
    }

    // LOSS encerra a rodada sem mover saldo, então não gera lançamento nenhum.
    if (!transaction.affectsBalance()) {
      transaction.markProcessed(undefined, now);
      return undefined;
    }

    const direction = transaction.ledgerDirectionFor(reference.transaction);

    if (direction === 'DEBIT' && !wallet.hasSufficientFunds(transaction.money)) {
      // Códigos distintos: aposta sem saldo é resposta esperada, reversão sem saldo é sintoma.
      transaction.reject(
        transaction.kind === 'BET' ? 'INSUFFICIENT_FUNDS' : 'REVERSAL_WOULD_OVERDRAW',
      );
      return undefined;
    }

    const expectedVersion = wallet.version;
    const movement = {
      transactionId: transaction.id,
      ledgerEntryId: newId(),
      money: transaction.money,
      at: now,
    };

    const entry = direction === 'DEBIT' ? wallet.debit(movement) : wallet.credit(movement);

    await this.ledger.append(entry);
    await this.wallets.update(wallet, expectedVersion);
    transaction.markProcessed(reference.transaction?.id, now);

    return entry;
  }

  private walletMismatch(transaction: WagerTransaction, wallet: Wallet): FailureCode | undefined {
    if (wallet.playerId !== transaction.playerId) {
      return 'WALLET_PLAYER_MISMATCH';
    }

    if (wallet.currency !== transaction.money.currency) {
      return 'CURRENCY_MISMATCH';
    }

    return undefined;
  }

  /**
   * Resolve a referência de REFUND e ROLLBACK. Referência que ainda não chegou não é rejeição:
   * a transação fica esperando e um worker tenta de novo.
   */
  private async resolveReference(transaction: WagerTransaction): Promise<ReferenceOutcome> {
    const externalId = transaction.requiresReference()
      ? transaction.referenceExternalTransactionId
      : undefined;

    if (!externalId) {
      return { outcome: 'RESOLVED' };
    }

    const reference = await this.transactions.findByExternalId(transaction.providerId, externalId);

    if (!reference) {
      return { outcome: 'AWAIT' };
    }

    const failureCode = await this.referenceFailure(transaction, reference);

    if (failureCode) {
      return { outcome: 'REJECT', failureCode };
    }

    return { outcome: 'RESOLVED', transaction: reference };
  }

  /** O que impede esta reversão de acontecer, ou nada quando a referência serve. */
  private async referenceFailure(
    transaction: WagerTransaction,
    reference: WagerTransaction,
  ): Promise<FailureCode | undefined> {
    if (reference.status !== 'PROCESSED') {
      return 'REFERENCE_NOT_PROCESSED';
    }

    const reversible = transaction.kind === 'REFUND' ? REFUNDABLE : ROLLBACKABLE;

    if (!reversible.includes(reference.kind)) {
      return 'REFERENCE_KIND_NOT_REVERSIBLE';
    }

    if (
      reference.playerId !== transaction.playerId ||
      reference.walletId !== transaction.walletId ||
      reference.roundId !== transaction.roundId ||
      reference.money.currency !== transaction.money.currency
    ) {
      return 'REFERENCE_MISMATCH';
    }

    // Reversão é total: valor diferente do original não é reversão parcial, é erro.
    if (!reference.money.equals(transaction.money)) {
      return 'REFERENCE_AMOUNT_MISMATCH';
    }

    if (await this.transactions.findReversal(reference.id, transaction.kind)) {
      return 'REFERENCE_ALREADY_REVERSED';
    }

    return undefined;
  }

  private async publish(
    transaction: WagerTransaction,
    wallet: Wallet,
    entry: WalletLedgerEntry | undefined,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    const context = () => ({
      eventId: newId(),
      correlationId,
      causationId: transaction.id,
      occurredAt: now,
    });

    const events: IntegrationEvent<unknown>[] = [this.outcomeEvent(transaction, context())];

    // Só existe evento de saldo quando o saldo mudou de fato.
    if (entry) {
      events.push(WalletBalanceChanged.from(wallet, entry, context()));
    }

    for (const event of events) {
      await this.outbox.enqueue(OutboxMessage.enqueue(event));
    }
  }

  private outcomeEvent(
    transaction: WagerTransaction,
    context: { eventId: string; correlationId: string; causationId: string; occurredAt: Date },
  ): IntegrationEvent<unknown> {
    if (transaction.status === 'REJECTED') {
      return WagerTransactionRejected.from(transaction, context);
    }

    if (transaction.status === 'PENDING_REFERENCE') {
      return WagerTransactionPendingReference.from(transaction, context);
    }

    return WagerTransactionProcessed.from(transaction, context);
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
