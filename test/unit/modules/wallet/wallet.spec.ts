import { describe, expect, it } from 'bun:test';
import { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import { Money } from '@shared/domain/money';
import { expectFailure } from '@test/support/failure';
import { expectBalanceMatchesLedger } from '@test/support/invariant';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const openedAt = new Date('2026-01-01T00:00:00.000Z');
const movedAt = new Date('2026-01-02T00:00:00.000Z');

const open = (amount = '100.00') =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(amount),
    openedAt,
    openingTransactionId: 'tx-opening',
    openingLedgerEntryId: 'entry-opening',
  });

const openWallet = (amount = '100.00') => open(amount).wallet;

const movement = (amount: string) => ({
  transactionId: 'tx-1',
  ledgerEntryId: 'entry-1',
  money: brl(amount),
  at: movedAt,
});

describe('Wallet.open', () => {
  it('abre com saldo inicial, versao 1 e moeda do saldo', () => {
    const wallet = openWallet('1000.00');

    expect(wallet.balance.toString()).toBe('1000.00');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.version).toBe(1);
    expect(wallet.updatedAt).toEqual(openedAt);
  });

  it('devolve o lancamento de abertura creditando de zero ao saldo inicial', () => {
    const { wallet, openingEntry } = open('1000.00');

    expect(openingEntry).toBeDefined();
    expect(openingEntry?.direction).toBe('CREDIT');
    expect(openingEntry?.id).toBe('entry-opening');
    expect(openingEntry?.walletId).toBe(wallet.id);
    expect(openingEntry?.transactionId).toBe('tx-opening');
    expect(openingEntry?.money.toString()).toBe('1000.00');
    expect(openingEntry?.balanceBefore.toString()).toBe('0.00');
    expect(openingEntry?.balanceAfter.toString()).toBe('1000.00');
    expect(openingEntry?.createdAt).toEqual(openedAt);
    expect(openingEntry?.isBalanced()).toBe(true);
  });

  it('nao incrementa a versao ao emitir o lancamento de abertura', () => {
    expect(open('1000.00').wallet.version).toBe(1);
  });

  it('abre com saldo zero e sem lancamento de abertura', () => {
    const { wallet, openingEntry } = open('0.00');

    expect(wallet.balance.isZero()).toBe(true);
    expect(wallet.version).toBe(1);
    expect(openingEntry).toBeUndefined();
  });

  it('rejeita saldo inicial negativo', () => {
    expectFailure(() => open('-1.00'), 'INVALID_MONEY');
  });
});

describe('Wallet.rehydrate', () => {
  it('reconstroi o estado persistido sem revalidar', () => {
    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: { amount: '42.50', currency: 'BRL' },
      version: 7,
      createdAt: openedAt,
      updatedAt: movedAt,
    });

    expect(wallet.balance.toString()).toBe('42.50');
    expect(wallet.version).toBe(7);
  });
});

describe('debito e credito', () => {
  it('debita, incrementa a versao e devolve o lancamento correspondente', () => {
    const wallet = openWallet('100.00');
    const entry = wallet.debit(movement('80.00'));

    expect(wallet.balance.toString()).toBe('20.00');
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(movedAt);
    expect(entry.direction).toBe('DEBIT');
    expect(entry.walletId).toBe('wallet-1');
    expect(entry.transactionId).toBe('tx-1');
    expect(entry.balanceBefore.toString()).toBe('100.00');
    expect(entry.balanceAfter.toString()).toBe('20.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('credita e incrementa a versao', () => {
    const wallet = openWallet('100.00');
    const entry = wallet.credit(movement('50.00'));

    expect(wallet.balance.toString()).toBe('150.00');
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe('CREDIT');
  });

  it('permite debitar o saldo exato', () => {
    const wallet = openWallet('100.00');
    wallet.debit(movement('100.00'));

    expect(wallet.balance.toString()).toBe('0.00');
  });

  it('rejeita debito que deixaria o saldo negativo sem alterar o estado', () => {
    const wallet = openWallet('100.00');

    expectFailure(() => wallet.debit(movement('100.01')), 'INSUFFICIENT_FUNDS');
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(wallet.updatedAt).toEqual(openedAt);
  });

  it.each([['0.00'], ['-10.00']])('rejeita movimentacao de valor %p', (amount) => {
    const wallet = openWallet('100.00');

    expectFailure(() => wallet.debit(movement(amount)), 'INVALID_MONEY');
    expectFailure(() => wallet.credit(movement(amount)), 'INVALID_MONEY');
    expect(wallet.version).toBe(1);
  });

  it('rejeita movimentacao em moeda diferente da wallet', () => {
    const wallet = openWallet('100.00');
    const usd = { ...movement('10.00'), money: Money.from({ amount: '10.00', currency: 'USD' }) };

    expectFailure(() => wallet.debit(usd), 'CURRENCY_MISMATCH');
    expectFailure(() => wallet.credit(usd), 'CURRENCY_MISMATCH');
  });

  it('mantem saldo igual ao reconstruido pelo ledger desde a abertura', () => {
    const { wallet, openingEntry } = open('100.00');
    const entries = [
      openingEntry,
      wallet.debit({ ...movement('30.00'), transactionId: 'tx-1', ledgerEntryId: 'entry-1' }),
      wallet.credit({ ...movement('55.50'), transactionId: 'tx-2', ledgerEntryId: 'entry-2' }),
      wallet.debit({ ...movement('5.50'), transactionId: 'tx-3', ledgerEntryId: 'entry-3' }),
    ].filter((entry) => entry !== undefined);

    expectBalanceMatchesLedger(wallet, entries);
    expect(wallet.balance.toString()).toBe('120.00');
    expect(wallet.version).toBe(4);
  });
});

describe('hasSufficientFunds', () => {
  it('trata o saldo exato como suficiente', () => {
    const wallet = openWallet('100.00');

    expect(wallet.hasSufficientFunds(brl('100.00'))).toBe(true);
    expect(wallet.hasSufficientFunds(brl('100.01'))).toBe(false);
  });

  it('rejeita comparacao em moeda diferente', () => {
    expectFailure(
      () => openWallet().hasSufficientFunds(Money.from({ amount: '1.00', currency: 'USD' })),
      'CURRENCY_MISMATCH',
    );
  });
});
