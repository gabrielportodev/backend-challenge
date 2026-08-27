import { describe, expect, it } from 'bun:test';
import {
  type EventContext,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
} from '@domain/events';
import { Money } from '@domain/shared/money';
import {
  type CreateWagerTransactionProps,
  WagerTransaction,
} from '@domain/wagering/wager-transaction';
import { Wallet } from '@domain/wallet/wallet';
import { expectFailure } from '@test/support/failure';

const occurredAt = new Date('2026-01-01T00:00:00.000Z');

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

const ctx: EventContext = {
  eventId: 'event-1',
  correlationId: 'corr-1',
  occurredAt,
};

const makeTx = (overrides: Partial<CreateWagerTransactionProps> = {}) =>
  WagerTransaction.create({
    id: 'tx-1',
    providerId: 'provider-1',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-1:ext-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: brl('80.00'),
    createdAt: occurredAt,
    ...overrides,
  });

describe('IntegrationEvent.toJSON', () => {
  it('serializa o envelope com eventType e version vindos do tipo', () => {
    const tx = makeTx();
    tx.markProcessed(undefined, occurredAt);

    const envelope = WagerTransactionProcessed.from(tx, ctx).toJSON();

    expect(envelope).toEqual({
      eventId: 'event-1',
      eventType: 'WagerTransactionProcessed',
      aggregateId: 'tx-1',
      correlationId: 'corr-1',
      causationId: undefined,
      occurredAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      data: {
        transactionId: 'tx-1',
        providerId: 'provider-1',
        externalTransactionId: 'ext-1',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '80.00', currency: 'BRL' },
        referenceExternalTransactionId: undefined,
      },
    });
  });

  it('carrega causationId quando existe e o omite do JSON quando não existe', () => {
    const tx = makeTx();

    const semCausation = WagerTransactionProcessed.from(tx, ctx).toJSON();
    const comCausation = WagerTransactionProcessed.from(tx, {
      ...ctx,
      causationId: 'msg-1',
    }).toJSON();

    expect(semCausation.causationId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(semCausation))).not.toHaveProperty('causationId');
    expect(comCausation.causationId).toBe('msg-1');
  });

  it('carrega dinheiro como string decimal, nunca como instância de Money', () => {
    const tx = makeTx();
    const { money } = WagerTransactionProcessed.from(tx, ctx).data;

    expect(money).toEqual({ amount: '80.00', currency: 'BRL' });
    expect(money).not.toBeInstanceOf(Money);
  });
});

describe('WagerTransactionProcessed', () => {
  it('inclui a referência quando a transação reverte outra', () => {
    const tx = makeTx({
      kind: 'REFUND',
      referenceExternalTransactionId: 'ext-0',
    });

    expect(WagerTransactionProcessed.from(tx, ctx).data.referenceExternalTransactionId).toBe(
      'ext-0',
    );
  });
});

describe('WagerTransactionRejected', () => {
  it('leva o failureCode da transação', () => {
    const tx = makeTx();
    tx.reject('INSUFFICIENT_FUNDS');

    const event = WagerTransactionRejected.from(tx, ctx);

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.data.failureCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('recusa rejeição sem failureCode', () => {
    expectFailure(() => WagerTransactionRejected.from(makeTx(), ctx), 'INVALID_TRANSACTION_STATE');
  });
});

describe('WagerTransactionPendingReference', () => {
  it('leva a referência ainda não resolvida', () => {
    const tx = makeTx({
      kind: 'ROLLBACK',
      referenceExternalTransactionId: 'ext-0',
    });
    tx.markPendingReference();

    expect(WagerTransactionPendingReference.from(tx, ctx).data.referenceExternalTransactionId).toBe(
      'ext-0',
    );
  });

  it('recusa transação sem referência', () => {
    expectFailure(() => WagerTransactionPendingReference.from(makeTx(), ctx), 'VALIDATION_FAILED');
  });
});

describe('WalletBalanceChanged', () => {
  it('reflete o lançamento e a versão da wallet', () => {
    const { wallet } = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('100.00'),
      openedAt: occurredAt,
      openingTransactionId: 'tx-opening',
      openingLedgerEntryId: 'entry-opening',
    });

    const entry = wallet.debit({
      transactionId: 'tx-1',
      ledgerEntryId: 'entry-1',
      money: brl('80.00'),
      at: occurredAt,
    });

    const event = WalletBalanceChanged.from(wallet, entry, ctx);

    expect(event.aggregateId).toBe('wallet-1');
    expect(event.data).toEqual({
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: 'DEBIT',
      money: { amount: '80.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '20.00', currency: 'BRL' },
      walletVersion: 2,
    });
  });
});
