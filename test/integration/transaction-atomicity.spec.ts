import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import {
  OUTBOX_REPOSITORY,
  type OutboxRepository,
} from '@modules/messaging/domain/outbox.repository.port';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';

const FALHA = 'outbox indisponível';

/**
 * Falha no último passo da transação financeira. O evento é a última escrita antes do commit,
 * então quebrar aqui é a forma mais dura de perguntar se as cinco escritas são mesmo uma só.
 */
const outboxQuebrado: OutboxRepository = {
  async enqueue() {
    throw new Error(FALHA);
  },
  async findDue() {
    return [];
  },
  async update() {},
};

describe('atomicidade da transação financeira', () => {
  let app: TestApp;
  let quebrada: TestApp;
  let api: ApiClient;
  let apiQuebrada: ApiClient;
  let walletId: string;

  beforeAll(async () => {
    app = await createTestApp();
    quebrada = await createTestApp({
      overrides: [{ token: OUTBOX_REPOSITORY, value: outboxQuebrado }],
    });
    api = apiClient(app.url);
    apiQuebrada = apiClient(quebrada.url);
  });

  afterAll(async () => {
    await quebrada.close();
    await app.close();
  });

  beforeEach(async () => {
    await app.reset();

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;
  });

  it('não deixa rastro nenhum quando a última escrita falha', async () => {
    const body = payload({ walletId, money: { amount: '30.00', currency: 'BRL' } });

    const resposta = await apiQuebrada.submit(body, 'k-atomica');

    expect(resposta.status).toBe(500);

    const transacoes = await app.sql(
      'select id from wager_transactions where idempotency_key = ?',
      ['k-atomica'],
    );
    const lancamentos = await app.sql('select id from wallet_ledger_entries where wallet_id = ?', [
      walletId,
    ]);
    const [wallet] = await app.sql<{ balance_amount: string; version: number }>(
      'select balance_amount, version from wallets where id = ?',
      [walletId],
    );

    expect(transacoes).toBeEmpty();
    // Só o lançamento da abertura, gravado antes: a aposta não deixou nada.
    expect(lancamentos).toHaveLength(1);
    expect(wallet?.balance_amount).toBe('100.00');
    expect(Number(wallet?.version)).toBe(1);

    await expectStoredBalancesMatchLedger(app.sql);
  });

  it('desfaz também o registro de inbox quando a mensagem vem da fila', async () => {
    const submit = quebrada.app.get(SubmitWagerTransactionUseCase);

    const execucao = submit.execute({
      idempotencyKey: 'k-inbox-atomica',
      correlationId: 'corr',
      payload: payload({ walletId, money: { amount: '30.00', currency: 'BRL' } }),
      inbox: { consumerName: 'wager-transactions', messageId: 'msg-atomica' },
    });

    await expect(execucao).rejects.toThrow(FALHA);

    const inbox = await app.sql('select message_id from inbox_messages where message_id = ?', [
      'msg-atomica',
    ]);

    expect(inbox).toBeEmpty();
    await expectStoredBalancesMatchLedger(app.sql);
  });

  it('mantém o caminho normal funcionando na instância sadia', async () => {
    const aceita = await api.submit(
      payload({ walletId, money: { amount: '30.00', currency: 'BRL' } }),
      'k-sadia',
    );

    expect(aceita.body.status).toBe('PROCESSED');
    expect(aceita.body.balance.amount).toBe('70.00');

    await expectStoredBalancesMatchLedger(app.sql);
  });
});
