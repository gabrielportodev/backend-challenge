import { describe, expect, it } from 'bun:test';
import {
  CurrencyMismatchError,
  InvalidMoneyError,
  UnbalancedLedgerEntryError,
} from '@domain/errors';
import { Money } from '@domain/shared/money';
import { type CreateLedgerEntryProps, WalletLedgerEntry } from '@domain/wallet/wallet-ledger-entry';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const createdAt = new Date('2026-01-01T00:00:00.000Z');

const props = (overrides: Partial<CreateLedgerEntryProps> = {}): CreateLedgerEntryProps => ({
  id: 'entry-1',
  walletId: 'wallet-1',
  transactionId: 'tx-1',
  direction: 'DEBIT',
  money: brl('80.00'),
  balanceBefore: brl('100.00'),
  balanceAfter: brl('20.00'),
  createdAt,
  ...overrides,
});

describe('WalletLedgerEntry.create', () => {
  it('aceita um debito com aritmetica correta', () => {
    const entry = WalletLedgerEntry.create(props());

    expect(entry.direction).toBe('DEBIT');
    expect(entry.balanceAfter.toString()).toBe('20.00');
    expect(entry.isBalanced()).toBe(true);
  });

  it('aceita um credito com aritmetica correta', () => {
    const entry = WalletLedgerEntry.create(
      props({
        direction: 'CREDIT',
        money: brl('50.00'),
        balanceBefore: brl('100.00'),
        balanceAfter: brl('150.00'),
      }),
    );

    expect(entry.isBalanced()).toBe(true);
  });

  it('rejeita debito com saldo final errado', () => {
    expect(() => WalletLedgerEntry.create(props({ balanceAfter: brl('30.00') }))).toThrow(
      UnbalancedLedgerEntryError,
    );
  });

  it('rejeita credito lancado como debito', () => {
    expect(() =>
      WalletLedgerEntry.create(
        props({ money: brl('50.00'), balanceBefore: brl('100.00'), balanceAfter: brl('150.00') }),
      ),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it.each([['0.00'], ['-10.00']])('rejeita lancamento de valor %p', (amount) => {
    expect(() => WalletLedgerEntry.create(props({ money: brl(amount) }))).toThrow(
      InvalidMoneyError,
    );
  });

  it('rejeita mistura de moedas', () => {
    expect(() =>
      WalletLedgerEntry.create(props({ money: Money.from({ amount: '80.00', currency: 'USD' }) })),
    ).toThrow(CurrencyMismatchError);
  });

  it('expoe o contexto da falha no erro', () => {
    try {
      WalletLedgerEntry.create(props({ balanceAfter: brl('30.00') }));
      expect.unreachable();
    } catch (error) {
      expect((error as UnbalancedLedgerEntryError).failureCode).toBe('LEDGER_ENTRY_UNBALANCED');
      expect((error as UnbalancedLedgerEntryError).details).toMatchObject({
        transactionId: 'tx-1',
        walletId: 'wallet-1',
        balanceBefore: '100.00',
        balanceAfter: '30.00',
      });
    }
  });
});

describe('WalletLedgerEntry.rehydrate', () => {
  it('reconstroi sem revalidar a aritmetica', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'entry-1',
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: 'DEBIT',
      money: { amount: '80.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '30.00', currency: 'BRL' },
      createdAt,
    });

    expect(entry.isBalanced()).toBe(false);
    expect(entry.money.toString()).toBe('80.00');
  });
});
