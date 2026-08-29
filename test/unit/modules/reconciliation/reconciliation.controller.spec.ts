import { beforeEach, describe, expect, it } from 'bun:test';
import { ReconcileWalletUseCase } from '@modules/reconciliation/application/use-cases/reconcile-wallet.use-case';
import { ReconciliationController } from '@modules/reconciliation/infra/http/reconciliation.controller';
import { CreateWalletUseCase } from '@modules/wallet/application/use-cases/create-wallet.use-case';
import { MetricsService } from '@shared/infra/metrics/metrics.service';
import { expectRejection } from '@test/support/failure';
import {
  ImmediateTransactionRunner,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '@test/support/fakes';

const AUSENTE = '00000000-0000-7000-8000-000000000000';

let controller: ReconciliationController;
let createWallet: CreateWalletUseCase;

beforeEach(() => {
  const runner = new ImmediateTransactionRunner();
  const wallets = new InMemoryWalletRepository();
  const transactions = new InMemoryWagerTransactionRepository();
  const ledger = new InMemoryLedgerRepository();
  const outbox = new InMemoryOutboxRepository();

  createWallet = new CreateWalletUseCase(runner, wallets, transactions, ledger, outbox);
  controller = new ReconciliationController(
    new ReconcileWalletUseCase(runner, wallets, ledger, new MetricsService()),
  );
});

describe('ReconciliationController', () => {
  it('reconcilia saldo e ledger', async () => {
    const wallet = await createWallet.execute({
      playerId: 'player-1',
      initialBalance: { amount: '1000.00', currency: 'BRL' },
      correlationId: 'corr',
    });
    const report = await controller.reconcile(wallet.id);

    expect(report.consistent).toBe(true);
    expect(report.storedBalance).toEqual(report.calculatedBalance);
    expect(report.difference).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(report.checkedEntries).toBe(1);
  });

  it('falha com WALLET_NOT_FOUND em wallet inexistente', async () => {
    await expectRejection(controller.reconcile(AUSENTE), 'WALLET_NOT_FOUND');
  });
});
