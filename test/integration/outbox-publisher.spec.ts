import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { OutboxPublisherWorker } from '@modules/messaging/application/outbox-publisher.worker';
import {
  MESSAGE_PUBLISHER,
  type MessagePublisherPort,
  type OutgoingMessage,
} from '@modules/messaging/domain/message-publisher.port';
import { OUTBOX_REPOSITORY } from '@modules/messaging/domain/outbox.repository.port';
import { TRANSACTION_RUNNER } from '@shared/kernel/transaction-runner.port';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';
import {
  closeQueueClient,
  collectMessages,
  drainQueue,
  QUEUES,
  receiveFrom,
} from '@test/support/queues';

interface OutboxRow {
  id: string;
  event_type: string;
  attempts: number;
  published_at: Date | null;
  next_attempt_at: Date | null;
}

/** Guarda o que passou por ele em vez de falar com a fila, para o teste conferir a divisão. */
class PublisherEspiao implements MessagePublisherPort {
  readonly enviados: string[] = [];

  async publish(message: OutgoingMessage): Promise<void> {
    this.enviados.push(message.id);
  }
}

describe('outbox e publicação de eventos', () => {
  let app: TestApp;
  let api: ApiClient;
  let walletId: string;

  const pendentes = () =>
    app.sql<OutboxRow>(
      'select id::text as id, event_type, attempts, published_at, next_attempt_at from outbox_messages order by occurred_at',
    );

  /** O worker de verdade, montado à mão para a varredura acontecer quando o teste quiser. */
  const worker = (publisher: MessagePublisherPort) =>
    new OutboxPublisherWorker(
      app.app.get(TRANSACTION_RUNNER),
      app.app.get(OUTBOX_REPOSITORY),
      publisher,
    );

  beforeAll(async () => {
    app = await createTestApp();
    api = apiClient(app.url);
  });

  afterAll(async () => {
    closeQueueClient();
    await app.close();
  });

  beforeEach(async () => {
    await app.reset();
    await drainQueue(QUEUES.events);

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;
  });

  afterEach(() => expectStoredBalancesMatchLedger(app.sql));

  it('deixa o evento no outbox e nada na fila antes da publicação', async () => {
    await api.submit(payload({ walletId, money: { amount: '30.00', currency: 'BRL' } }), 'k-1');

    const linhas = await pendentes();
    const naFila = await receiveFrom(QUEUES.events, 10, 0);

    // Abertura da wallet, desfecho da aposta e mudança de saldo.
    expect(linhas.map((linha) => linha.event_type)).toEqual([
      'WalletBalanceChanged',
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
    expect(linhas.every((linha) => linha.published_at === null)).toBe(true);
    expect(naFila).toBeEmpty();
  });

  it('publica os pendentes na fila de eventos e marca a linha como publicada', async () => {
    await api.submit(payload({ walletId, money: { amount: '30.00', currency: 'BRL' } }), 'k-1');

    const publicados = await worker(app.app.get(MESSAGE_PUBLISHER)).publishPending();
    const mensagens = await collectMessages(QUEUES.events, 3);
    const tipos = mensagens
      .map((mensagem) => (JSON.parse(mensagem.body) as { eventType: string }).eventType)
      .sort();

    expect(publicados).toBe(3);
    expect(tipos).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
      'WalletBalanceChanged',
    ]);
    expect((await pendentes()).every((linha) => linha.published_at !== null)).toBe(true);
  });

  it('divide o trabalho entre dois publishers sem publicar o mesmo evento duas vezes', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api.submit(payload({ walletId, money: { amount: '5.00', currency: 'BRL' } }), `k-${i}`);
    }

    const primeiro = new PublisherEspiao();
    const segundo = new PublisherEspiao();

    await Promise.all([worker(primeiro).publishPending(), worker(segundo).publishPending()]);

    const enviados = [...primeiro.enviados, ...segundo.enviados];
    const linhas = await pendentes();

    // Abertura mais dois eventos por aposta.
    expect(linhas).toHaveLength(11);
    expect(enviados).toHaveLength(11);
    expect(new Set(enviados).size).toBe(11);
    expect(linhas.every((linha) => linha.published_at !== null)).toBe(true);
  });

  it('reagenda o evento que falhou sem derrubar o resto do lote', async () => {
    await api.submit(payload({ walletId, money: { amount: '30.00', currency: 'BRL' } }), 'k-1');

    const [alvo] = await pendentes();
    const publisher: MessagePublisherPort = {
      async publish(message) {
        if (message.id === alvo?.id) {
          throw new Error('fila indisponível');
        }
      },
    };

    await worker(publisher).publishPending();

    const linhas = await pendentes();
    const falhou = linhas.find((linha) => linha.id === alvo?.id);

    expect(Number(falhou?.attempts)).toBe(1);
    expect(falhou?.published_at).toBeNull();
    expect(falhou?.next_attempt_at).not.toBeNull();
    expect(linhas.filter((linha) => linha.published_at !== null)).toHaveLength(2);
  });

  it('publicação duplicada do mesmo evento chega uma vez só na fila', async () => {
    const publisher = app.app.get<MessagePublisherPort>(MESSAGE_PUBLISHER);
    const evento: OutgoingMessage = {
      id: crypto.randomUUID(),
      groupId: walletId,
      body: JSON.stringify({ eventType: 'WagerTransactionProcessed' }),
    };

    // O crash entre publicar e commitar faz o worker republicar: o eventId vai como chave de
    // deduplicação, então a fila descarta a cópia.
    await publisher.publish(evento);
    await publisher.publish(evento);

    expect(await collectMessages(QUEUES.events, 2, 3_000)).toHaveLength(1);
  });
});
