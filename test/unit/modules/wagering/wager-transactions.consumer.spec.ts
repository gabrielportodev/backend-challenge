import { beforeEach, describe, expect, it } from 'bun:test';
import type {
  IncomingMessage,
  MessageConsumerPort,
} from '@modules/messaging/domain/message-consumer.port';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import type { WagerTransaction } from '@modules/wagering/domain/wager-transaction.aggregate';
import { WagerTransactionsConsumer } from '@modules/wagering/infra/sqs/wager-transactions.consumer';
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

/** A fila em memória: guarda o que foi lido e registra o destino que o consumidor deu a cada um. */
class FakeQueue implements MessageConsumerPort {
  readonly acked: string[] = [];
  readonly released: Array<{ id: string; delaySeconds: number }> = [];
  readonly deadLettered: string[] = [];
  private pending: IncomingMessage[] = [];

  offer(message: IncomingMessage): void {
    this.pending.push(message);
  }

  async receive(max: number): Promise<IncomingMessage[]> {
    return this.pending.splice(0, max);
  }

  async ack(message: IncomingMessage): Promise<void> {
    this.acked.push(message.id);
  }

  async retryLater(message: IncomingMessage, delaySeconds: number): Promise<void> {
    this.released.push({ id: message.id, delaySeconds });
  }

  async deadLetter(message: IncomingMessage): Promise<void> {
    this.deadLettered.push(message.id);
  }
}

/** Quebra o insert uma vez, como faria um banco fora do ar: não é recusa de negócio. */
class FlakyTransactionRepository extends InMemoryWagerTransactionRepository {
  private broken = false;

  breakOnce(): void {
    this.broken = true;
  }

  override async insert(transaction: WagerTransaction): Promise<void> {
    if (this.broken) {
      this.broken = false;
      throw new Error('conexão perdida');
    }

    await super.insert(transaction);
  }
}

let queue: FakeQueue;
let consumer: WagerTransactionsConsumer;
let transactions: FlakyTransactionRepository;
let inbox: InMemoryInboxRepository;
let ledger: InMemoryLedgerRepository;
let walletId: string;

function envelope(over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return JSON.stringify({
    messageId: 'msg-1',
    type: 'WagerTransactionRequested',
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...over,
    data: {
      providerId: 'provider-a',
      externalTransactionId: 'tx-1',
      idempotencyKey: 'provider-a:tx-1',
      playerId: 'player-1',
      walletId,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      ...data,
    },
  });
}

function message(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'sqs-1',
    receiptHandle: 'handle-1',
    receiveCount: 1,
    body: envelope(),
    ...over,
  };
}

beforeEach(async () => {
  const runner = new ImmediateTransactionRunner();
  const wallets = new InMemoryWalletRepository();

  transactions = new FlakyTransactionRepository();
  ledger = new InMemoryLedgerRepository();
  inbox = new InMemoryInboxRepository();
  queue = new FakeQueue();

  const outbox = new InMemoryOutboxRepository();
  const createWallet = new CreateWalletUseCase(runner, wallets, transactions, ledger, outbox);
  const useCase = new SubmitWagerTransactionUseCase(
    runner,
    wallets,
    transactions,
    inbox,
    new WagerSettlement(wallets, transactions, ledger, outbox),
    new MetricsService(),
  );

  walletId = (
    await createWallet.execute({
      playerId: 'player-1',
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'corr',
    })
  ).id;

  consumer = new WagerTransactionsConsumer(queue, useCase, new MetricsService());
});

async function ledgerBalance(): Promise<string> {
  return (await ledger.summarize(walletId, 'BRL')).balance.toString();
}

describe('WagerTransactionsConsumer', () => {
  it('processa a mensagem, registra o inbox e só então tira da fila', async () => {
    queue.offer(message());

    expect(await consumer.consumeBatch()).toBe(1);

    const stored = await transactions.findByExternalId('provider-a', 'tx-1');

    expect(stored?.status).toBe('PROCESSED');
    expect(queue.acked).toEqual(['sqs-1']);
    expect(inbox.messages.map((entry) => entry.messageId)).toEqual(['msg-1']);
    expect(await ledgerBalance()).toBe('75.00');
  });

  it('reentrega não duplica o débito', async () => {
    queue.offer(message());
    queue.offer(message({ id: 'sqs-2', receiptHandle: 'handle-2', receiveCount: 2 }));

    await consumer.consumeBatch();

    expect(queue.acked).toEqual(['sqs-1', 'sqs-2']);
    expect(ledger.entries).toHaveLength(2);
    expect(await ledgerBalance()).toBe('75.00');
  });

  it('manda para a DLQ o envelope que não dá para ler', async () => {
    queue.offer(message({ body: '{"isso": "não é um envelope"}' }));

    await consumer.consumeBatch();

    expect(queue.deadLettered).toEqual(['sqs-1']);
    expect(queue.acked).toEqual(['sqs-1']);
    expect(queue.released).toEqual([]);
  });

  it('manda para a DLQ o corpo que nem é JSON', async () => {
    queue.offer(message({ body: 'não é json' }));

    await consumer.consumeBatch();

    expect(queue.deadLettered).toEqual(['sqs-1']);
  });

  it('trata rejeição de negócio como terminal e tira da fila', async () => {
    queue.offer(message({ body: envelope({}, { walletId: crypto.randomUUID() }) }));

    await consumer.consumeBatch();

    expect(queue.acked).toEqual(['sqs-1']);
    expect(queue.deadLettered).toEqual([]);
    expect(queue.released).toEqual([]);
  });

  it('devolve a mensagem com espera crescente quando a falha é transitória', async () => {
    transactions.breakOnce();
    queue.offer(message({ receiveCount: 3 }));

    await consumer.consumeBatch();

    expect(queue.released).toEqual([{ id: 'sqs-1', delaySeconds: 20 }]);
    expect(queue.acked).toEqual([]);
  });

  it('manda para a DLQ quando a falha transitória esgota as tentativas', async () => {
    transactions.breakOnce();
    queue.offer(message({ receiveCount: 5 }));

    await consumer.consumeBatch();

    expect(queue.deadLettered).toEqual(['sqs-1']);
    expect(queue.acked).toEqual(['sqs-1']);
    expect(queue.released).toEqual([]);
  });

  it('trata o lote inteiro, sem parar na mensagem que falhou', async () => {
    queue.offer(message({ body: 'não é json' }));
    queue.offer(message({ id: 'sqs-2', receiptHandle: 'handle-2' }));

    expect(await consumer.consumeBatch()).toBe(2);
    expect(queue.acked).toEqual(['sqs-1', 'sqs-2']);
    expect(await ledgerBalance()).toBe('75.00');
  });
});
