import { DuplicateTransactionError } from '@application/errors';
import type {
  InboxRepository,
  LedgerPage,
  LedgerRepository,
  LedgerSummary,
  OutboxRepository,
  TransactionRunner,
  WagerTransactionRepository,
  WalletRepository,
} from '@application/ports';
import { DomainError } from '@domain/errors';
import type { InboxMessage, OutboxMessage } from '@domain/messaging';
import { Money } from '@domain/shared/money';
import {
  WagerTransaction,
  type WagerTransactionKind,
  type WagerTransactionState,
} from '@domain/wagering/wager-transaction';
import { Wallet, type WalletState } from '@domain/wallet/wallet';
import type { WalletLedgerEntry } from '@domain/wallet/wallet-ledger-entry';

/**
 * Repositórios em memória que guardam estado, não objetos de domínio: cada leitura reidrata uma
 * instância nova. Assim um use case que esquece de chamar `update` não passa no teste por estar
 * segurando a mesma referência que o "banco".
 */

function walletState(wallet: Wallet): WalletState {
  return {
    id: wallet.id,
    playerId: wallet.playerId,
    currency: wallet.currency,
    balance: wallet.balance.toJSON(),
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

function transactionState(transaction: WagerTransaction): WagerTransactionState {
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    idempotencyKey: transaction.idempotencyKey,
    payloadHash: transaction.payloadHash,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    createdAt: transaction.createdAt,
    status: transaction.status,
    referenceTransactionId: transaction.referenceTransactionId,
    failureCode: transaction.failureCode,
    processedAt: transaction.processedAt,
  };
}

export class InMemoryWalletRepository implements WalletRepository {
  private readonly rows = new Map<string, WalletState>();

  all(): Wallet[] {
    return [...this.rows.values()].map((state) => Wallet.rehydrate(state));
  }

  async findById(id: string): Promise<Wallet | null> {
    const state = this.rows.get(id);

    return state ? Wallet.rehydrate(state) : null;
  }

  async findByPlayer(playerId: string, currency: string): Promise<Wallet | null> {
    const state = [...this.rows.values()].find(
      (row) => row.playerId === playerId && row.currency === currency,
    );

    return state ? Wallet.rehydrate(state) : null;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | null> {
    return this.findById(id);
  }

  async insert(wallet: Wallet): Promise<void> {
    if (await this.findByPlayer(wallet.playerId, wallet.currency)) {
      throw new DomainError(
        'WALLET_ALREADY_EXISTS',
        `Já existe wallet de ${wallet.currency} para o player ${wallet.playerId}`,
      );
    }

    this.rows.set(wallet.id, walletState(wallet));
  }

  async update(wallet: Wallet, expectedVersion: number): Promise<void> {
    const current = this.rows.get(wallet.id);

    if (!current || current.version !== expectedVersion) {
      throw new Error(`Wallet ${wallet.id} mudou fora do lock`);
    }

    this.rows.set(wallet.id, walletState(wallet));
  }
}

export class InMemoryWagerTransactionRepository implements WagerTransactionRepository {
  private readonly rows = new Map<string, WagerTransactionState>();

  all(): WagerTransaction[] {
    return [...this.rows.values()].map((state) => WagerTransaction.rehydrate(state));
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    const state = this.rows.get(id);

    return state ? WagerTransaction.rehydrate(state) : null;
  }

  async findByIdempotencyKey(
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    return this.first(
      (row) => row.providerId === providerId && row.idempotencyKey === idempotencyKey,
    );
  }

  async findByExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    return this.first(
      (row) => row.providerId === providerId && row.externalTransactionId === externalTransactionId,
    );
  }

  async findPendingReference(limit: number): Promise<WagerTransaction[]> {
    return this.all()
      .filter((transaction) => transaction.status === 'PENDING_REFERENCE')
      .slice(0, limit);
  }

  async findReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    return this.first(
      (row) =>
        row.referenceTransactionId === referenceTransactionId &&
        row.kind === kind &&
        row.status === 'PROCESSED',
    );
  }

  async insert(transaction: WagerTransaction): Promise<void> {
    const byKey = await this.findByIdempotencyKey(
      transaction.providerId,
      transaction.idempotencyKey,
    );
    const byExternal = await this.findByExternalId(
      transaction.providerId,
      transaction.externalTransactionId,
    );

    if (byKey || byExternal) {
      throw new DuplicateTransactionError('wager_transactions');
    }

    this.rows.set(transaction.id, transactionState(transaction));
  }

  async update(transaction: WagerTransaction): Promise<void> {
    this.rows.set(transaction.id, transactionState(transaction));
  }

  private first(matches: (row: WagerTransactionState) => boolean): WagerTransaction | null {
    const state = [...this.rows.values()].find(matches);

    return state ? WagerTransaction.rehydrate(state) : null;
  }
}

export class InMemoryLedgerRepository implements LedgerRepository {
  readonly entries: WalletLedgerEntry[] = [];

  async append(entry: WalletLedgerEntry): Promise<void> {
    this.entries.push(entry);
  }

  /** Cursor simplificado: o id do último lançamento devolvido marca a posição. */
  async listByWallet(walletId: string, limit: number, cursor?: string): Promise<LedgerPage> {
    const all = this.forWallet(walletId);
    const start = cursor ? all.findIndex((entry) => entry.id === cursor) + 1 : 0;
    const page = all.slice(start, start + limit);
    const last = page.at(-1);

    return {
      entries: page,
      nextCursor: start + page.length < all.length && last ? last.id : undefined,
    };
  }

  async summarize(walletId: string, currency: string): Promise<LedgerSummary> {
    const entries = this.forWallet(walletId);

    return {
      balance: entries.reduce(
        (total, entry) =>
          entry.direction === 'DEBIT' ? total.subtract(entry.money) : total.add(entry.money),
        Money.zero(currency),
      ),
      entries: entries.length,
    };
  }

  forWallet(walletId: string): WalletLedgerEntry[] {
    return this.entries.filter((entry) => entry.walletId === walletId);
  }
}

export class InMemoryOutboxRepository implements OutboxRepository {
  readonly messages: OutboxMessage[] = [];

  async enqueue(message: OutboxMessage): Promise<void> {
    this.messages.push(message);
  }

  async findDue(limit: number, now: Date): Promise<OutboxMessage[]> {
    return this.messages.filter((message) => message.isDue(now)).slice(0, limit);
  }

  async update(): Promise<void> {}

  types(): string[] {
    return this.messages.map((message) => message.eventType);
  }
}

export class InMemoryInboxRepository implements InboxRepository {
  readonly messages: InboxMessage[] = [];

  async find(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    return (
      this.messages.find(
        (message) => message.consumerName === consumerName && message.messageId === messageId,
      ) ?? null
    );
  }

  async insert(message: InboxMessage): Promise<void> {
    if (await this.find(message.consumerName, message.messageId)) {
      throw new DuplicateTransactionError('inbox_messages');
    }

    this.messages.push(message);
  }

  async update(): Promise<void> {}
}

/** Roda o bloco direto, contando quantas transações foram abertas. */
export class ImmediateTransactionRunner implements TransactionRunner {
  runs = 0;

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.runs += 1;

    return work();
  }
}
