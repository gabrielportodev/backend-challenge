import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { type AppInstances, startInstances } from '@test/support/instances';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';
import { drainAllQueues } from '@test/support/queues';

const INSTANCIAS = 3;

/**
 * Concorrência de verdade: as requisições saem para três processos diferentes, que só têm o
 * Postgres em comum. Nenhum lock de aplicação ajuda aqui — quem serializa é o banco.
 */
describe('wallet disputada por várias instâncias', () => {
  let controle: TestApp;
  let instancias: AppInstances;
  let clientes: ApiClient[];
  let walletId: string;

  const debitos = async (id = walletId) =>
    controle.sql(
      `select id from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [id],
    );

  beforeAll(async () => {
    controle = await createTestApp();
    instancias = await startInstances(INSTANCIAS);
    clientes = instancias.all.map((instancia) => apiClient(instancia.url));
  });

  afterAll(async () => {
    await instancias.stopAll();
    await controle.close();
  });

  beforeEach(async () => {
    await controle.reset();

    const created = await apiClient(controle.url).createWallet('player-1', '100.00');

    walletId = created.body.id;
  });

  afterEach(() => expectStoredBalancesMatchLedger(controle.sql));

  it('mantém as três instâncias respondendo em portas distintas', async () => {
    const saudes = await Promise.all(
      instancias.all.map((instancia) => fetch(`${instancia.url}/health/ready`)),
    );

    expect(saudes.map((resposta) => resposta.status)).toEqual([200, 200, 200]);
  });

  it('aceita só uma de duas apostas de 80,00 simultâneas sobre saldo de 100,00', async () => {
    const primeira = payload({ walletId, money: { amount: '80.00', currency: 'BRL' } });
    const segunda = payload({ walletId, money: { amount: '80.00', currency: 'BRL' } });

    const [a, b] = await Promise.all([
      (clientes[0] as ApiClient).submit(primeira, 'k-a'),
      (clientes[1] as ApiClient).submit(segunda, 'k-b'),
    ]);

    const status = [a?.body.status, b?.body.status].sort();

    expect(status).toEqual(['PROCESSED', 'REJECTED']);
    expect([a, b].find((resposta) => resposta?.body.status === 'REJECTED')?.body.failureCode).toBe(
      'INSUFFICIENT_FUNDS',
    );

    const wallet = await apiClient(controle.url).getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('20.00');
    expect(await debitos()).toHaveLength(1);
  });

  it('gera um único débito com a mesma aposta enviada 50 vezes em paralelo', async () => {
    const aposta = payload({ walletId, money: { amount: '10.00', currency: 'BRL' } });

    const respostas = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        (clientes[i % INSTANCIAS] as ApiClient).submit(aposta, 'k-repetida'),
      ),
    );

    const ids = new Set(respostas.map((resposta) => resposta.body.transactionId));

    expect(respostas.every((resposta) => [200, 409].includes(resposta.status))).toBe(true);
    expect(ids.size).toBe(1);
    expect(await debitos()).toHaveLength(1);

    const wallet = await apiClient(controle.url).getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('90.00');
    expect(wallet.body.version).toBe(2);
  });

  it('não perde nenhum débito com vinte apostas distintas em paralelo', async () => {
    const respostas = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (clientes[i % INSTANCIAS] as ApiClient).submit(
          payload({ walletId, money: { amount: '5.00', currency: 'BRL' } }),
          `k-${i}`,
        ),
      ),
    );

    const desfechos = respostas.map(
      (resposta) => `${resposta.status} ${resposta.body.status ?? resposta.body.failureCode}`,
    );

    expect(desfechos.filter((desfecho) => desfecho !== '200 PROCESSED')).toEqual([]);
    expect(await debitos()).toHaveLength(20);

    const wallet = await apiClient(controle.url).getWallet(walletId);

    // Cem menos vinte de cinco: nenhuma escrita se perdeu por cima da outra.
    expect(wallet.body.balance.amount).toBe('0.00');
    expect(wallet.body.version).toBe(21);
  });

  it('processa wallets diferentes em paralelo, sem lock global', async () => {
    const controleApi = apiClient(controle.url);
    const carteiras = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        controleApi.createWallet(`player-paralelo-${i}`, '50.00'),
      ),
    );

    const respostas = await Promise.all(
      carteiras.map((carteira, i) =>
        (clientes[i % INSTANCIAS] as ApiClient).submit(
          payload({
            walletId: carteira.body.id,
            playerId: `player-paralelo-${i}`,
            money: { amount: '20.00', currency: 'BRL' },
          }),
          `k-paralela-${i}`,
        ),
      ),
    );

    expect(respostas.every((resposta) => resposta.body.balance.amount === '30.00')).toBe(true);

    for (const carteira of carteiras) {
      expect(await debitos(carteira.body.id)).toHaveLength(1);
    }
  });

  it('mantém a reconciliação fechada depois de toda a disputa', async () => {
    const controleApi = apiClient(controle.url);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (clientes[i % INSTANCIAS] as ApiClient).submit(
          payload({
            walletId,
            kind: i % 2 === 0 ? 'BET' : 'WIN',
            money: { amount: '10.00', currency: 'BRL' },
          }),
          `k-mista-${i}`,
        ),
      ),
    );

    const relatorio = await controleApi.reconcile(walletId);

    expect(relatorio.body.consistent).toBe(true);
    expect(relatorio.body.difference.amount).toBe('0.00');
  });

  afterAll(() => drainAllQueues());
});
