import { beforeEach, describe, expect, it } from 'bun:test';
import { CreateWalletUseCase } from '@application/wallet/create-wallet.use-case';
import { GetLedgerUseCase } from '@application/wallet/get-ledger.use-case';
import { GetWalletUseCase } from '@application/wallet/get-wallet.use-case';
import { ReconcileWalletUseCase } from '@application/wallet/reconcile-wallet.use-case';
import { WalletController } from '@interfaces/http/controllers/wallet.controller';
import { expectRejection } from '@test/support/failure';
import {
  ImmediateTransactionRunner,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '@test/unit/application/fakes';

const AUSENTE = '00000000-0000-7000-8000-000000000000';

let controller: WalletController;

beforeEach(() => {
  const runner = new ImmediateTransactionRunner();
  const wallets = new InMemoryWalletRepository();
  const transactions = new InMemoryWagerTransactionRepository();
  const ledger = new InMemoryLedgerRepository();
  const outbox = new InMemoryOutboxRepository();

  controller = new WalletController(
    new CreateWalletUseCase(runner, wallets, transactions, ledger, outbox),
    new GetWalletUseCase(wallets),
    new GetLedgerUseCase(wallets, ledger),
    new ReconcileWalletUseCase(runner, wallets, ledger),
  );
});

const criar = (amount = '1000.00') =>
  controller.create({ playerId: 'player-1', initialBalance: { amount, currency: 'BRL' } }, 'corr');

describe('WalletController', () => {
  it('devolve id, playerId, saldo e version na criação', async () => {
    const wallet = await criar();

    expect(wallet.playerId).toBe('player-1');
    expect(wallet.balance).toEqual({ amount: '1000.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  it('devolve o saldo como string decimal, nunca number', async () => {
    const wallet = await criar('0.10');

    expect(typeof wallet.balance.amount).toBe('string');
  });

  it('consulta a wallet criada', async () => {
    const criada = await criar();

    expect(await controller.byId(criada.id)).toEqual(criada);
  });

  it('lista o ledger com saldo antes e depois', async () => {
    const wallet = await criar();
    const page = await controller.ledger(wallet.id, {});

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.direction).toBe('CREDIT');
    expect(page.entries[0]?.balanceBefore).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(page.entries[0]?.balanceAfter).toEqual({ amount: '1000.00', currency: 'BRL' });
    expect(page.nextCursor).toBeUndefined();
  });

  it('reconcilia saldo e ledger', async () => {
    const wallet = await criar();
    const report = await controller.reconcile(wallet.id);

    expect(report.consistent).toBe(true);
    expect(report.storedBalance).toEqual(report.calculatedBalance);
    expect(report.difference).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(report.checkedEntries).toBe(1);
  });

  it('falha com WALLET_NOT_FOUND em wallet inexistente', async () => {
    await expectRejection(controller.byId(AUSENTE), 'WALLET_NOT_FOUND');
    await expectRejection(controller.ledger(AUSENTE, {}), 'WALLET_NOT_FOUND');
    await expectRejection(controller.reconcile(AUSENTE), 'WALLET_NOT_FOUND');
  });
});
