import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { type AppInstances, startInstances } from '@test/support/instances';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';
import { closeQueueClient, collectMessages, drainQueue, QUEUES } from '@test/support/queues';
import { waitUntil } from '@test/support/wait';

const APOSTAS = 5;
// Abertura da wallet mais desfecho e mudança de saldo por aposta.
const EVENTOS = 1 + APOSTAS * 2;

/**
 * Dois publishers de verdade, em processos separados, varrendo o mesmo outbox. A divisão é
 * feita pelo `FOR UPDATE SKIP LOCKED`: cada um pega um lote e ninguém repete o trabalho do outro.
 */
describe('publishers concorrentes sobre o mesmo outbox', () => {
  let controle: TestApp;
  let instancias: AppInstances;
  let api: ApiClient;
  let walletId: string;

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
    await drainQueue(QUEUES.events);

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;

    for (let i = 0; i < APOSTAS; i += 1) {
      await api.submit(payload({ walletId, money: { amount: '5.00', currency: 'BRL' } }), `k-${i}`);
    }
  });

  afterEach(async () => {
    await instancias?.stopAll();

    await expectStoredBalancesMatchLedger(controle.sql);
  });

  it('publica cada evento uma única vez com dois processos varrendo juntos', async () => {
    const pendentes = await controle.sql(
      'select id from outbox_messages where published_at is null',
    );

    expect(pendentes).toHaveLength(EVENTOS);

    instancias = await startInstances(2, 3250);

    await waitUntil('o outbox esvaziar', async () => {
      const restantes = await controle.sql(
        'select id from outbox_messages where published_at is null',
      );

      return restantes.length === 0;
    });

    const daWallet = await collectMessages(QUEUES.events, EVENTOS, 15_000, (mensagem) =>
      mensagem.body.includes(walletId),
    );
    const ids = daWallet.map(
      (mensagem) => (JSON.parse(mensagem.body) as { eventId: string }).eventId,
    );

    expect(daWallet).toHaveLength(EVENTOS);
    expect(new Set(ids).size).toBe(EVENTOS);

    // Nenhuma tentativa perdida: ninguém tropeçou numa linha que o outro já tinha pegado.
    const comFalha = await controle.sql('select id from outbox_messages where attempts > 0');

    expect(comFalha).toBeEmpty();
  });
});
