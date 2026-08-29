import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { type AppInstance, type AppInstances, startInstances } from '@test/support/instances';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';
import {
  closeQueueClient,
  drainQueue,
  QUEUES,
  queueDepth,
  sendToQueue,
  wagerMessage,
} from '@test/support/queues';
import { waitUntil } from '@test/support/wait';

const CONSUMER = 'wager-transactions';

/**
 * O que acontece quando um processo some no meio do caminho. O pior instante é entre o commit e
 * o ack: o efeito financeiro já existe e a fila ainda acha que ninguém tratou a mensagem.
 */
describe('queda de instância e retomada', () => {
  let controle: TestApp;
  let instancias: AppInstances;
  let api: ApiClient;
  let walletId: string;
  let extras: AppInstance[] = [];

  beforeAll(async () => {
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
    await instancias?.stopAll();
    await Promise.all(extras.map((instancia) => instancia.stop()));
    extras = [];

    await expectStoredBalancesMatchLedger(controle.sql);
  });

  it('não debita duas vezes quando o processo morre depois do commit e antes do ack', async () => {
    const aposta = payload({ walletId, money: { amount: '30.00', currency: 'BRL' } });
    const mensagem = wagerMessage('msg-crash', aposta, 'k-crash');

    await sendToQueue(QUEUES.wager, mensagem, walletId);

    // O instante do crash, reproduzido por construção: a transação commita com o registro de
    // inbox e o `ack` nunca acontece. Correr um SIGKILL contra o ack não seria reproduzível.
    const commitado = await controle.app.get(SubmitWagerTransactionUseCase).execute({
      idempotencyKey: 'k-crash',
      correlationId: 'msg-crash',
      payload: aposta,
      inbox: { consumerName: CONSUMER, messageId: 'msg-crash' },
    });

    expect(commitado.transaction.status).toBe('PROCESSED');

    // A mensagem continua na fila e será entregue de novo a quem estiver de pé.
    instancias = await startInstances(1, 3210);

    await waitUntil('a fila esvaziar depois da reentrega', async () => {
      const { visible, inFlight } = await queueDepth(QUEUES.wager);

      return visible + inFlight === 0;
    });

    const debitos = await controle.sql(
      `select id from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );
    const transacoes = await controle.sql('select id from wager_transactions where kind = ?', [
      'BET',
    ]);
    const wallet = await api.getWallet(walletId);

    expect(debitos).toHaveLength(1);
    expect(transacoes).toHaveLength(1);
    expect(wallet.body.balance.amount).toBe('70.00');
  });

  it('segue processando nas instâncias que sobraram quando uma é morta', async () => {
    instancias = await startInstances(3, 3220);

    const sobreviventes = [instancias.pick(1), instancias.pick(2)];

    instancias.pick(0).kill();

    await waitUntil('a instância morta parar de responder', async () => {
      try {
        await fetch(`${instancias.pick(0).url}/health/live`);

        return false;
      } catch {
        return true;
      }
    });

    const respostas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        apiClient((sobreviventes[i % 2] as AppInstance).url).submit(
          payload({ walletId, money: { amount: '5.00', currency: 'BRL' } }),
          `k-sobrevivente-${i}`,
        ),
      ),
    );

    expect(respostas.every((resposta) => resposta.body.status === 'PROCESSED')).toBe(true);

    const wallet = await api.getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('50.00');
  });

  it('mantém a consistência depois de a instância voltar', async () => {
    instancias = await startInstances(2, 3230);

    instancias.pick(0).kill();

    // Sobe de novo, como um orquestrador faria depois da queda.
    const reiniciada = await startInstances(1, 3240);

    extras = reiniciada.all;

    await apiClient(reiniciada.pick(0).url).submit(
      payload({ walletId, money: { amount: '25.00', currency: 'BRL' } }),
      'k-depois-do-reinicio',
    );

    const relatorio = await api.reconcile(walletId);

    expect(relatorio.body.consistent).toBe(true);
    expect(relatorio.body.storedBalance.amount).toBe('75.00');
  });
});
