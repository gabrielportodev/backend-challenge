import { beforeEach, describe, expect, it } from 'bun:test';
import { ReconcileWalletUseCase } from '@modules/reconciliation/application/use-cases/reconcile-wallet.use-case';
import { GetTransactionUseCase } from '@modules/wagering/application/use-cases/get-transaction.use-case';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import { CreateWalletUseCase } from '@modules/wallet/application/use-cases/create-wallet.use-case';
import { GetLedgerUseCase } from '@modules/wallet/application/use-cases/get-ledger.use-case';
import { GetWalletUseCase } from '@modules/wallet/application/use-cases/get-wallet.use-case';
import { WalletLedgerEntry } from '@modules/wallet/domain/wallet-ledger-entry.entity';
import { Money } from '@shared/domain/money';
import { expectRejection } from '@test/support/failure';
import {
  ImmediateTransactionRunner,
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '@test/support/fakes';

const AUSENTE = '00000000-0000-7000-8000-000000000000';

let ledger: InMemoryLedgerRepository;
let getWallet: GetWalletUseCase;
let getLedger: GetLedgerUseCase;
let getTransaction: GetTransactionUseCase;
let reconcile: ReconcileWalletUseCase;
let walletId: string;
let apostas: string[];

beforeEach(async () => {
  const runner = new ImmediateTransactionRunner();
  const wallets = new InMemoryWalletRepository();
  const transactions = new InMemoryWagerTransactionRepository();
  const outbox = new InMemoryOutboxRepository();

  ledger = new InMemoryLedgerRepository();

  const createWallet = new CreateWalletUseCase(runner, wallets, transactions, ledger, outbox);
  const submit = new SubmitWagerTransactionUseCase(
    runner,
    wallets,
    transactions,
    new InMemoryInboxRepository(),
    new WagerSettlement(wallets, transactions, ledger, outbox),
  );

  getWallet = new GetWalletUseCase(wallets);
  getLedger = new GetLedgerUseCase(wallets, ledger);
  getTransaction = new GetTransactionUseCase(transactions);
  reconcile = new ReconcileWalletUseCase(runner, wallets, ledger);

  const wallet = await createWallet.execute({
    playerId: 'player-1',
    initialBalance: { amount: '100.00', currency: 'BRL' },
    correlationId: 'corr',
  });

  walletId = wallet.id;
  apostas = [];

  // Abertura mais três apostas: quatro lançamentos, o suficiente para paginar.
  for (const numero of [1, 2, 3]) {
    const { transaction } = await submit.execute({
      idempotencyKey: `provider-a:bet-${numero}`,
      correlationId: 'corr',
      payload: {
        providerId: 'provider-a',
        externalTransactionId: `bet-${numero}`,
        playerId: 'player-1',
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      },
    });

    apostas.push(transaction.id);
  }
});

describe('consulta de wallet', () => {
  it('devolve a wallet pelo id', async () => {
    const wallet = await getWallet.execute(walletId);

    expect(wallet.balance.toString()).toBe('70.00');
    expect(wallet.version).toBe(4);
  });

  it('falha quando a wallet não existe', async () => {
    await expectRejection(getWallet.execute(AUSENTE), 'WALLET_NOT_FOUND');
  });
});

describe('extrato do ledger', () => {
  it('pagina pelo cursor sem repetir nem pular lançamento', async () => {
    const primeira = await getLedger.execute({ walletId, limit: 3 });

    expect(primeira.entries).toHaveLength(3);
    expect(primeira.nextCursor).toBeDefined();

    const segunda = await getLedger.execute({
      walletId,
      limit: 3,
      cursor: primeira.nextCursor,
    });

    const ids = [...primeira.entries, ...segunda.entries].map((entry) => entry.id);

    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('não devolve cursor na última página', async () => {
    const pagina = await getLedger.execute({ walletId, limit: 50 });

    expect(pagina.entries).toHaveLength(4);
    expect(pagina.nextCursor).toBeUndefined();
  });

  it('apara limite fora da faixa em vez de recusar', async () => {
    await expect(getLedger.execute({ walletId, limit: 0 })).resolves.toBeDefined();
    await expect(getLedger.execute({ walletId, limit: 10_000 })).resolves.toBeDefined();
  });

  it('falha quando a wallet não existe', async () => {
    await expectRejection(getLedger.execute({ walletId: AUSENTE }), 'WALLET_NOT_FOUND');
  });
});

describe('consulta de transação', () => {
  it('encontra pelo id interno', async () => {
    const transaction = await getTransaction.byId(apostas[0] as string);

    expect(transaction.externalTransactionId).toBe('bet-1');
  });

  it('encontra pelo id do provedor', async () => {
    const transaction = await getTransaction.byExternalId('provider-a', 'bet-2');

    expect(transaction.id).toBe(apostas[1] as string);
  });

  it('não encontra transação de outro provedor', async () => {
    await expectRejection(
      getTransaction.byExternalId('provider-b', 'bet-2'),
      'TRANSACTION_NOT_FOUND',
    );
  });

  it('falha quando a transação não existe', async () => {
    await expectRejection(getTransaction.byId(AUSENTE), 'TRANSACTION_NOT_FOUND');
  });
});

describe('reconciliação', () => {
  it('confirma que o saldo bate com o ledger', async () => {
    const report = await reconcile.execute(walletId);

    expect(report.consistent).toBe(true);
    expect(report.storedBalance.toString()).toBe('70.00');
    expect(report.calculatedBalance.toString()).toBe('70.00');
    expect(report.difference.toString()).toBe('0.00');
    expect(report.checkedEntries).toBe(4);
  });

  it('aponta divergência sem corrigir nada', async () => {
    // Lançamento solto, como se uma escrita tivesse escapado da transação.
    ledger.entries.push(
      WalletLedgerEntry.create({
        id: '018f2f00-0000-7000-8000-0000000000ff',
        walletId,
        transactionId: apostas[0] as string,
        direction: 'CREDIT',
        money: Money.from({ amount: '5.00', currency: 'BRL' }),
        balanceBefore: Money.zero('BRL'),
        balanceAfter: Money.from({ amount: '5.00', currency: 'BRL' }),
        createdAt: new Date(),
      }),
    );

    const report = await reconcile.execute(walletId);

    expect(report.consistent).toBe(false);
    expect(report.calculatedBalance.toString()).toBe('75.00');
    expect(report.difference.toString()).toBe('-5.00');
    expect(report.checkedEntries).toBe(5);

    const wallet = await getWallet.execute(walletId);
    expect(wallet.balance.toString()).toBe('70.00');
  });

  it('falha quando a wallet não existe', async () => {
    await expectRejection(reconcile.execute(AUSENTE), 'WALLET_NOT_FOUND');
  });
});
