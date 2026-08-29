import { beforeEach, describe, expect, it } from 'bun:test';
import { PendingReferenceWorker } from '@modules/wagering/application/pending-reference.worker';
import {
  SubmitWagerTransactionUseCase,
  type WagerTransactionPayload,
} from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import { CreateWalletUseCase } from '@modules/wallet/application/use-cases/create-wallet.use-case';
import { MetricsService } from '@shared/infra/metrics/metrics.service';
import {
  ImmediateTransactionRunner,
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '@test/support/fakes';

const PROVIDER = 'provider-a';
/** Depois do primeiro backoff de 30s: é quando o worker pode pegar a transação. */
const DEPOIS_DO_BACKOFF = new Date(Date.now() + 60_000);

let wallets: InMemoryWalletRepository;
let transactions: InMemoryWagerTransactionRepository;
let ledger: InMemoryLedgerRepository;
let outbox: InMemoryOutboxRepository;
let worker: PendingReferenceWorker;
let submit: (
  payload: Partial<WagerTransactionPayload> & { externalTransactionId: string },
) => Promise<void>;
let walletId: string;

beforeEach(async () => {
  const runner = new ImmediateTransactionRunner();

  wallets = new InMemoryWalletRepository();
  transactions = new InMemoryWagerTransactionRepository();
  ledger = new InMemoryLedgerRepository();
  outbox = new InMemoryOutboxRepository();

  const settlement = new WagerSettlement(wallets, transactions, ledger, outbox);
  const useCase = new SubmitWagerTransactionUseCase(
    runner,
    wallets,
    transactions,
    new InMemoryInboxRepository(),
    settlement,
    new MetricsService(),
  );

  worker = new PendingReferenceWorker(
    runner,
    transactions,
    wallets,
    settlement,
    new MetricsService(),
  );

  const wallet = await new CreateWalletUseCase(
    runner,
    wallets,
    transactions,
    ledger,
    outbox,
  ).execute({
    playerId: 'player-1',
    initialBalance: { amount: '100.00', currency: 'BRL' },
    correlationId: 'corr',
  });

  walletId = wallet.id;

  submit = async (payload) => {
    await useCase.execute({
      idempotencyKey: `${PROVIDER}:${payload.externalTransactionId}`,
      correlationId: 'corr',
      payload: {
        providerId: PROVIDER,
        playerId: 'player-1',
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
        ...payload,
      },
    });
  };

  outbox.messages.length = 0;
});

const refundOrfao = () =>
  submit({
    externalTransactionId: 'refund-1',
    kind: 'REFUND',
    referenceExternalTransactionId: 'bet-1',
  });

const buscar = async (externalTransactionId: string) =>
  transactions.findByExternalId(PROVIDER, externalTransactionId);

describe('PendingReferenceWorker', () => {
  it('nao pega a transacao antes do backoff vencer', async () => {
    await refundOrfao();

    expect(await worker.resolveDue(new Date())).toBe(0);
  });

  it('processa o refund quando a referencia finalmente chega', async () => {
    await refundOrfao();
    await submit({ externalTransactionId: 'bet-1', kind: 'BET' });

    const total = await worker.resolveDue(DEPOIS_DO_BACKOFF);

    expect(total).toBe(1);

    const refund = await buscar('refund-1');
    expect(refund?.status).toBe('PROCESSED');

    // 100 - 10 da aposta + 10 do refund.
    const wallet = await wallets.findById(walletId);
    expect(wallet?.balance.toString()).toBe('100.00');
    expect(ledger.forWallet(walletId)).toHaveLength(3);
  });

  it('publica o resultado quando a transacao chega a um estado terminal', async () => {
    await refundOrfao();
    await submit({ externalTransactionId: 'bet-1', kind: 'BET' });
    outbox.messages.length = 0;

    await worker.resolveDue(DEPOIS_DO_BACKOFF);

    expect(outbox.types()).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
  });

  it('reagenda sem publicar evento enquanto a referencia nao aparece', async () => {
    await refundOrfao();
    outbox.messages.length = 0;

    await worker.resolveDue(DEPOIS_DO_BACKOFF);

    const refund = await buscar('refund-1');
    expect(refund?.status).toBe('PENDING_REFERENCE');
    expect(refund?.referenceAttempts).toBe(2);
    expect(outbox.messages).toHaveLength(0);
  });

  it('rejeita com REFERENCE_NOT_FOUND depois de esgotar as tentativas', async () => {
    await refundOrfao();
    outbox.messages.length = 0;

    // A submissão já gastou a primeira tentativa; o worker gasta as outras nove.
    let agora = DEPOIS_DO_BACKOFF;

    for (let volta = 0; volta < 9; volta += 1) {
      await worker.resolveDue(agora);
      agora = new Date(agora.getTime() + 600_000);
    }

    const refund = await buscar('refund-1');
    expect(refund?.status).toBe('REJECTED');
    expect(refund?.failureCode).toBe('REFERENCE_NOT_FOUND');
    expect(outbox.types()).toEqual(['WagerTransactionRejected']);

    // Rejeição não move saldo: só o lançamento da abertura da wallet.
    expect(ledger.forWallet(walletId)).toHaveLength(1);
  });

  it('nao mexe mais na transacao depois de rejeitar', async () => {
    await refundOrfao();

    let agora = DEPOIS_DO_BACKOFF;

    for (let volta = 0; volta < 9; volta += 1) {
      await worker.resolveDue(agora);
      agora = new Date(agora.getTime() + 600_000);
    }

    expect(await worker.resolveDue(agora)).toBe(0);
  });
});
