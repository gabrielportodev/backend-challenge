import { describe, expect, it } from 'bun:test';
import { CreateWalletUseCase } from '@modules/wallet/application/use-cases/create-wallet.use-case';
import type { TransactionRunner } from '@shared/kernel/transaction-runner.port';
import { expectRejection } from '@test/support/failure';
import {
  ImmediateTransactionRunner,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '@test/support/fakes';
import { expectBalanceMatchesLedger } from '@test/support/invariant';

/** Não executa o bloco: o que for gravado mesmo assim estava fora da transação. */
class SkippingTransactionRunner implements TransactionRunner {
  async run<T>(): Promise<T> {
    return undefined as unknown as T;
  }
}

function build(runner: TransactionRunner = new ImmediateTransactionRunner()) {
  const wallets = new InMemoryWalletRepository();
  const transactions = new InMemoryWagerTransactionRepository();
  const ledger = new InMemoryLedgerRepository();
  const outbox = new InMemoryOutboxRepository();

  const useCase = new CreateWalletUseCase(runner, wallets, transactions, ledger, outbox);

  return { useCase, wallets, transactions, ledger, outbox };
}

const command = {
  playerId: 'player-1',
  initialBalance: { amount: '1000.00', currency: 'BRL' },
  correlationId: 'corr-1',
};

describe('criação de wallet', () => {
  it('abre com saldo inicial gerando OPENING, lançamento e evento', async () => {
    const ctx = build();

    const wallet = await ctx.useCase.execute(command);

    expect(wallet.balance.toString()).toBe('1000.00');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.version).toBe(1);

    const opening = ctx.transactions.all()[0];
    expect(opening?.kind).toBe('OPENING');
    expect(opening?.status).toBe('PROCESSED');
    expect(opening?.money.toString()).toBe('1000.00');

    const entry = ctx.ledger.entries[0];
    expect(entry?.direction).toBe('CREDIT');
    expect(entry?.balanceBefore.toString()).toBe('0.00');
    expect(entry?.balanceAfter.toString()).toBe('1000.00');
    expect(entry?.transactionId).toBe(opening?.id);
    expect(entry?.walletId).toBe(wallet.id);

    expect(ctx.outbox.types()).toEqual(['WalletBalanceChanged']);
  });

  it('deixa o saldo gravado igual ao reconstruído pelo ledger', async () => {
    const ctx = build();

    const wallet = await ctx.useCase.execute(command);

    expectBalanceMatchesLedger(wallet, ctx.ledger.forWallet(wallet.id));
  });

  it('saldo inicial zero cria só a wallet, sem movimentação', async () => {
    const ctx = build();

    const wallet = await ctx.useCase.execute({
      ...command,
      initialBalance: { amount: '0.00', currency: 'BRL' },
    });

    expect(wallet.balance.toString()).toBe('0.00');
    expect(ctx.wallets.all()).toHaveLength(1);
    expect(ctx.transactions.all()).toBeEmpty();
    expect(ctx.ledger.entries).toBeEmpty();
    expect(ctx.outbox.messages).toBeEmpty();
  });

  it('recusa a segunda wallet do mesmo player e moeda', async () => {
    const ctx = build();

    await ctx.useCase.execute(command);

    await expectRejection(ctx.useCase.execute(command), 'WALLET_ALREADY_EXISTS');
    expect(ctx.wallets.all()).toHaveLength(1);
  });

  it('abre wallet separada para outra moeda do mesmo player', async () => {
    const ctx = build();

    await ctx.useCase.execute(command);
    await ctx.useCase.execute({
      ...command,
      initialBalance: { amount: '10.00', currency: 'USD' },
    });

    expect(ctx.wallets.all()).toHaveLength(2);
  });

  it('recusa saldo inicial negativo sem abrir transação', async () => {
    const runner = new ImmediateTransactionRunner();
    const ctx = build(runner);

    await expectRejection(
      ctx.useCase.execute({ ...command, initialBalance: { amount: '-1.00', currency: 'BRL' } }),
      'INVALID_MONEY',
    );

    expect(runner.runs).toBe(0);
  });

  it('não grava nada fora da transação', async () => {
    const ctx = build(new SkippingTransactionRunner());

    await ctx.useCase.execute(command);

    expect(ctx.wallets.all()).toBeEmpty();
    expect(ctx.transactions.all()).toBeEmpty();
    expect(ctx.ledger.entries).toBeEmpty();
    expect(ctx.outbox.messages).toBeEmpty();
  });
});
