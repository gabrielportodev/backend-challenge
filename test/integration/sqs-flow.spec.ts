import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';
import {
  closeQueueClient,
  collectMessages,
  drainQueue,
  QUEUES,
  queueDepth,
  sendToQueue,
  wagerMessage,
} from '@test/support/queues';
import { waitUntil } from '@test/support/wait';

/**
 * O caminho completo da fila, com o serviço inteiro no ar: consumidor lendo, transação
 * commitando e worker do outbox publicando o resultado na fila de saída.
 */
describe('fluxo SQS ponta a ponta', () => {
  let controle: TestApp;
  let servico: TestApp | undefined;
  let api: ApiClient;
  let walletId: string;

  const transacaoProcessada = async (idempotencyKey: string) => {
    const [linha] = await controle.sql<{ status: string }>(
      'select status from wager_transactions where idempotency_key = ?',
      [idempotencyKey],
    );

    return linha?.status === 'PROCESSED';
  };

  beforeAll(async () => {
    // Instância de apoio, sem workers: prepara os dados e observa o banco sem disputar a fila.
    controle = await createTestApp();
    api = apiClient(controle.url);
  });

  afterAll(async () => {
    closeQueueClient();
    await controle.close();
  });

  beforeEach(async () => {
    await controle.reset();
    await drainQueue(QUEUES.wager);
    await drainQueue(QUEUES.events);

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;
  });

  afterEach(async () => {
    await servico?.close();
    servico = undefined;

    await expectStoredBalancesMatchLedger(controle.sql);
  });

  it('processa a aposta que chega pela fila e publica o resultado', async () => {
    servico = await createTestApp({ workers: true });

    const aposta = payload({ walletId, money: { amount: '30.00', currency: 'BRL' } });

    await sendToQueue(QUEUES.wager, wagerMessage('msg-e2e', aposta, 'k-e2e'), walletId);

    await waitUntil('a aposta ser processada', () => transacaoProcessada('k-e2e'));

    const wallet = await api.getWallet(walletId);
    const inbox = await controle.sql('select message_id from inbox_messages where message_id = ?', [
      'msg-e2e',
    ]);
    const debitos = await controle.sql(
      `select id from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );

    expect(wallet.body.balance.amount).toBe('70.00');
    expect(inbox).toHaveLength(1);
    expect(debitos).toHaveLength(1);

    // A mensagem só sai da fila depois do commit, mas sai.
    await waitUntil('a mensagem sair da fila', async () => {
      const { visible, inFlight } = await queueDepth(QUEUES.wager);

      return visible + inFlight === 0;
    });

    // Conta só a wallet do teste: mensagem esquecida de outra rodada não ocupa vaga.
    const eventos = await collectMessages(QUEUES.events, 3, 15_000, (evento) =>
      evento.body.includes(walletId),
    );
    const tipos = eventos.map(
      (evento) => (JSON.parse(evento.body) as { eventType: string }).eventType,
    );

    expect(tipos).toContain('WagerTransactionProcessed');
    expect(tipos.filter((tipo) => tipo === 'WalletBalanceChanged')).toHaveLength(2);
  });

  it('processa o que chegou enquanto o serviço estava fora do ar', async () => {
    const aposta = payload({ walletId, money: { amount: '25.00', currency: 'BRL' } });

    // Nenhuma instância consumindo: a mensagem espera na fila.
    await sendToQueue(QUEUES.wager, wagerMessage('msg-offline', aposta, 'k-offline'), walletId);
    await Bun.sleep(500);

    expect(await transacaoProcessada('k-offline')).toBe(false);

    servico = await createTestApp({ workers: true });

    await waitUntil('a aposta ser processada depois do reinício', () =>
      transacaoProcessada('k-offline'),
    );

    const wallet = await api.getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('75.00');
  });

  it('recusa pela fila o tipo interno OPENING', async () => {
    servico = await createTestApp({ workers: true });

    const interna = { ...payload({ walletId }), kind: 'OPENING' };

    await sendToQueue(
      QUEUES.wager,
      wagerMessage('msg-opening', interna as never, 'k-opening'),
      walletId,
    );

    // Envelope recusado na validação de borda: vai para a DLQ, não vira transação.
    await waitUntil('a mensagem sair da fila de entrada', async () => {
      const { visible, inFlight } = await queueDepth(QUEUES.wager);

      return visible + inFlight === 0;
    });

    expect(
      await controle.sql('select id from wager_transactions where idempotency_key = ?', [
        'k-opening',
      ]),
    ).toBeEmpty();

    await drainQueue(QUEUES.dlq);
  });
});
