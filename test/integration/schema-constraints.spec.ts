import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { sqlStateOf } from '@test/support/database';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload, TEST_PROVIDER } from '@test/support/payloads';

/** Confere que a escrita foi barrada pelo Postgres, e pelo motivo certo. */
async function expectSqlState(work: Promise<unknown>, state: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    expect(sqlStateOf(error)).toBe(state);
    return;
  }

  throw new Error(`Esperava o banco recusar com ${state}, mas a escrita passou`);
}

/**
 * As garantias do desafio precisam estar no schema, não só no código. Aqui elas são atacadas
 * por SQL cru, passando por cima da aplicação: o que barra é o banco.
 */
describe('constraints do schema', () => {
  let app: TestApp;
  let api: ApiClient;
  let walletId: string;

  const UNIQUE = '23505';
  const CHECK = '23514';
  const FOREIGN_KEY = '23503';
  const TRIGGER = 'P0001';

  async function inserirTransacao(over: Record<string, unknown> = {}): Promise<string> {
    const id = crypto.randomUUID();
    const row: Record<string, unknown> = {
      id,
      provider_id: TEST_PROVIDER,
      external_transaction_id: `ext-${id}`,
      idempotency_key: `key-${id}`,
      payload_hash: 'a'.repeat(64),
      wallet_id: walletId,
      player_id: 'player-1',
      round_id: 'round-1',
      game_id: 'game-1',
      kind: 'BET',
      amount: '10.00',
      currency: 'BRL',
      status: 'PROCESSED',
      created_at: new Date(),
      ...over,
    };

    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');

    await app.sql(
      `insert into wager_transactions (${columns.join(', ')}) values (${placeholders})`,
      Object.values(row),
    );

    return id;
  }

  async function inserirLancamento(over: Record<string, unknown> = {}): Promise<void> {
    const row: Record<string, unknown> = {
      id: crypto.randomUUID(),
      wallet_id: walletId,
      transaction_id: await inserirTransacao(),
      direction: 'DEBIT',
      currency: 'BRL',
      amount: '10.00',
      balance_before_amount: '100.00',
      balance_after_amount: '90.00',
      created_at: new Date(),
      ...over,
    };

    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');

    await app.sql(
      `insert into wallet_ledger_entries (${columns.join(', ')}) values (${placeholders})`,
      Object.values(row),
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    api = apiClient(app.url);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await app.reset();

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;
  });

  // Sem a invariante global no afterEach: os lançamentos deste arquivo são fabricados à mão para
  // atacar o schema, então não descrevem movimento nenhum da aplicação.

  it('aceita uma única wallet por player e moeda', async () => {
    await expectSqlState(
      app.sql(
        `insert into wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
         values (?, 'player-1', 'BRL', '0.00', 1, now(), now())`,
        [crypto.randomUUID()],
      ),
      UNIQUE,
    );
  });

  it('recusa saldo negativo', async () => {
    await expectSqlState(
      app.sql(`update wallets set balance_amount = '-0.01' where id = ?`, [walletId]),
      CHECK,
    );
  });

  it('recusa a segunda transação com a mesma chave de idempotência', async () => {
    await inserirTransacao({ idempotency_key: 'mesma-chave' });

    await expectSqlState(inserirTransacao({ idempotency_key: 'mesma-chave' }), UNIQUE);
  });

  it('recusa a segunda transação com o mesmo externalTransactionId', async () => {
    await inserirTransacao({ external_transaction_id: 'mesmo-externo' });

    await expectSqlState(inserirTransacao({ external_transaction_id: 'mesmo-externo' }), UNIQUE);
  });

  it('recusa transação de wallet inexistente', async () => {
    await expectSqlState(inserirTransacao({ wallet_id: crypto.randomUUID() }), FOREIGN_KEY);
  });

  it('aceita no máximo um lançamento por wallet e transação', async () => {
    const transactionId = await inserirTransacao();

    await inserirLancamento({ transaction_id: transactionId });

    await expectSqlState(inserirLancamento({ transaction_id: transactionId }), UNIQUE);
  });

  it('recusa lançamento cuja aritmética não fecha', async () => {
    await expectSqlState(inserirLancamento({ balance_after_amount: '95.00' }), CHECK);
  });

  it('recusa a segunda reversão do mesmo tipo sobre a mesma referência', async () => {
    const referencia = await inserirTransacao();

    await inserirTransacao({ kind: 'REFUND', reference_transaction_id: referencia });

    await expectSqlState(
      inserirTransacao({ kind: 'REFUND', reference_transaction_id: referencia }),
      UNIQUE,
    );
  });

  describe('ledger append-only', () => {
    beforeEach(() => inserirLancamento());

    it('não deixa alterar um lançamento', async () => {
      await expectSqlState(app.sql(`update wallet_ledger_entries set amount = '1.00'`), TRIGGER);
    });

    it('não deixa apagar um lançamento', async () => {
      await expectSqlState(app.sql('delete from wallet_ledger_entries'), TRIGGER);
    });

    it('não deixa truncar a tabela', async () => {
      await expectSqlState(app.sql('truncate wallet_ledger_entries'), TRIGGER);
    });
  });

  it('guarda dinheiro em numeric com escala 2, nunca em ponto flutuante', async () => {
    const colunas = await app.sql<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_scale: number;
    }>(`
      select table_name, column_name, data_type, numeric_scale
        from information_schema.columns
       where table_schema = 'public' and column_name like '%amount%'
    `);

    expect(colunas.length).toBeGreaterThanOrEqual(5);

    for (const coluna of colunas) {
      expect(`${coluna.table_name}.${coluna.column_name}: ${coluna.data_type}`).toBe(
        `${coluna.table_name}.${coluna.column_name}: numeric`,
      );
      expect(Number(coluna.numeric_scale)).toBe(2);
    }
  });

  it('rejeita pela aplicação a aposta que deixaria o saldo negativo, antes do check', async () => {
    const recusada = await api.submit(
      payload({ walletId, money: { amount: '500.00', currency: 'BRL' } }),
      'k-check',
    );

    expect(recusada.body.failureCode).toBe('INSUFFICIENT_FUNDS');

    const [wallet] = await app.sql<{ balance_amount: string }>(
      'select balance_amount from wallets where id = ?',
      [walletId],
    );

    expect(wallet?.balance_amount).toBe('100.00');
    await expectStoredBalancesMatchLedger(app.sql);
  });
});
