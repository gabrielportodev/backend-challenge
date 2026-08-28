import {
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from '@modules/messaging/domain/outbox.repository.port';
import { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import type {
  WagerTransaction,
  WagerTransactionKind,
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
import type { FailureCode } from '@shared/domain/errors';
import { newId } from '@shared/kernel/id';
import type { EventContext, IntegrationEvent } from '@shared/kernel/integration-event';

const REFUNDABLE: WagerTransactionKind[] = ['BET'];
const ROLLBACKABLE: WagerTransactionKind[] = ['BET', 'WIN', 'REFUND'];

/**
 * O destino da referência de um REFUND ou ROLLBACK: seguir em frente (com a referência quando o
 * tipo exige uma), esperar a referência chegar, ou rejeitar por um motivo específico.
 */
type ReferenceOutcome =
  | { outcome: 'RESOLVED'; transaction?: WagerTransaction }
  | { outcome: 'AWAIT' }
  | { outcome: 'REJECT'; failureCode: FailureCode };

/**
 * O que decide o destino de uma transação e move o saldo. Fica fora dos use cases porque duas
 * entradas precisam da mesma regra: a submissão (HTTP e fila) e o worker que reprocessa quem
 * ficou esperando referência. Sempre chamado com a wallet já travada, dentro de uma transação.
 */
@Injectable()
export class WagerSettlement {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepository,
    @Inject(WAGER_TRANSACTION_REPOSITORY)
    private readonly transactions: WagerTransactionRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Decide o destino da transação e, quando há movimento, grava ledger e saldo. Devolve o
   * lançamento gerado, ou nada quando a transação não move saldo.
   */
  async settle(
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
      transaction.markPendingReference(now);
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

  /** Enfileira no outbox o que aconteceu com a transação. Commita junto com o resto. */
  async publish(
    transaction: WagerTransaction,
    wallet: Wallet,
    entry: WalletLedgerEntry | undefined,
    correlationId: string,
    now: Date,
  ): Promise<void> {
    const context = (): EventContext => ({
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

  private outcomeEvent(
    transaction: WagerTransaction,
    context: EventContext,
  ): IntegrationEvent<unknown> {
    if (transaction.status === 'REJECTED') {
      return WagerTransactionRejected.from(transaction, context);
    }

    if (transaction.status === 'PENDING_REFERENCE') {
      return WagerTransactionPendingReference.from(transaction, context);
    }

    return WagerTransactionProcessed.from(transaction, context);
  }
}
