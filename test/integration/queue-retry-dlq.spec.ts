import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { MESSAGE_CONSUMER } from '@modules/messaging/domain/message-consumer.port';
import {
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from '@modules/messaging/domain/outbox.repository.port';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { WagerTransactionsConsumer } from '@modules/wagering/infra/sqs/wager-transactions.consumer';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';
import {
  closeQueueClient,
  collectMessages,
  drainQueue,
  QUEUES,
  queueAttribute,
  queueDepth,
  sendToQueue,
  wagerMessage,
} from '@test/support/queues';
import { waitUntil } from '@test/support/wait';

/** Instância cuja transação sempre falha por infraestrutura, para exercitar o retry. */
const outboxQuebrado: OutboxRepository = {
  async enqueue() {
    throw new Error('outbox indisponível');
  },
  async findDue() {
    return [];
  },
  async update() {},
};

describe('classificação de falhas do consumidor', () => {
  let app: TestApp;
  let quebrada: TestApp;
  let api: ApiClient;
  let consumer: WagerTransactionsConsumer;
  let consumerQuebrado: WagerTransactionsConsumer;
  let walletId: string;

  const montaConsumidor = (instancia: TestApp) =>
    new WagerTransactionsConsumer(
      instancia.app.get(MESSAGE_CONSUMER),
      instancia.app.get(SubmitWagerTransactionUseCase),
    );

  beforeAll(async () => {
    app = await createTestApp();
    quebrada = await createTestApp({
      overrides: [{ token: OUTBOX_REPOSITORY, value: outboxQuebrado }],
    });
    api = apiClient(app.url);
    consumer = montaConsumidor(app);
    consumerQuebrado = montaConsumidor(quebrada);
  });

  afterAll(async () => {
    closeQueueClient();
    await quebrada.close();
    await app.close();
  });

  beforeEach(async () => {
    await app.reset();
    await drainQueue(QUEUES.wager);
    await drainQueue(QUEUES.dlq);

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;
  });

  afterEach(() => expectStoredBalancesMatchLedger(app.sql));

  it('manda para a DLQ o envelope que não dá para ler', async () => {
    await sendToQueue(QUEUES.wager, { isto: 'não é um envelope' }, 'grupo-invalido');

    expect(await consumer.consumeBatch()).toBe(1);

    const naDlq = await collectMessages(QUEUES.dlq, 1, 10_000);

    expect(naDlq.filter((mensagem) => mensagem.body.includes('não é um envelope'))).toHaveLength(1);
    expect((await queueDepth(QUEUES.wager)).visible).toBe(0);
  });

  it('trata rejeição de negócio como terminal: tira da fila sem retry nem DLQ', async () => {
    const inexistente = payload({ walletId: crypto.randomUUID() });

    await sendToQueue(
      QUEUES.wager,
      wagerMessage('msg-sem-wallet', inexistente, 'k-sem-wallet'),
      inexistente.walletId,
    );

    expect(await consumer.consumeBatch()).toBe(1);

    await waitUntil('a fila esvaziar', async () => {
      const { visible, inFlight } = await queueDepth(QUEUES.wager);

      return visible + inFlight === 0;
    });

    const naDlq = await collectMessages(QUEUES.dlq, 1, 2_000);

    expect(naDlq.filter((mensagem) => mensagem.body.includes('msg-sem-wallet'))).toBeEmpty();
  });

  it('devolve para a fila a mensagem que falhou por infraestrutura', async () => {
    const aposta = payload({ walletId, money: { amount: '30.00', currency: 'BRL' } });

    await sendToQueue(
      QUEUES.wager,
      wagerMessage('msg-transitoria', aposta, 'k-transitoria'),
      walletId,
    );

    expect(await consumerQuebrado.consumeBatch()).toBe(1);

    // Nada foi gravado e a mensagem continua na fila, invisível até o fim da espera.
    expect(
      await app.sql('select id from wager_transactions where idempotency_key = ?', [
        'k-transitoria',
      ]),
    ).toBeEmpty();

    await waitUntil(
      'a mensagem voltar a ficar visível',
      async () => (await queueDepth(QUEUES.wager)).visible === 1,
      15_000,
    );

    // Na volta, a instância sadia conclui o que a quebrada não conseguiu.
    await waitUntil('a instância sadia processar', async () => (await consumer.consumeBatch()) > 0);

    const [transacao] = await app.sql<{ status: string }>(
      'select status from wager_transactions where idempotency_key = ?',
      ['k-transitoria'],
    );

    expect(transacao?.status).toBe('PROCESSED');
  });

  it('tem a DLQ ligada na fila de entrada com limite de cinco entregas', async () => {
    const politica = await queueAttribute(QUEUES.wager, 'RedrivePolicy');
    const parsed = JSON.parse(politica ?? '{}') as {
      maxReceiveCount: string;
      deadLetterTargetArn: string;
    };

    expect(String(parsed.maxReceiveCount)).toBe('5');
    expect(parsed.deadLetterTargetArn).toEndWith('wager-transactions-dlq.fifo');
  });
});
