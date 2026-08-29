import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload, TEST_PROVIDER } from '@test/support/payloads';

/** Fluxo ponta a ponta pela API, contra o Postgres do container. */
describe('fluxo HTTP ponta a ponta', () => {
  let app: TestApp;
  let api: ApiClient;
  let walletId: string;

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

  afterEach(() => expectStoredBalancesMatchLedger(app.sql));

  it('abre a wallet com transação de abertura e lançamento no ledger', async () => {
    const wallet = await api.getWallet(walletId);
    const ledger = await api.getLedger(walletId);

    expect(wallet.body.balance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.body.version).toBe(1);
    expect(ledger.body.entries).toHaveLength(1);
    expect(ledger.body.entries[0]?.direction).toBe('CREDIT');
  });

  it('debita a aposta e credita o ganho', async () => {
    const bet = await api.submit(
      payload({ walletId, money: { amount: '30.00', currency: 'BRL' } }),
      'k-bet',
    );
    const win = await api.submit(
      payload({ walletId, kind: 'WIN', money: { amount: '50.00', currency: 'BRL' } }),
      'k-win',
    );

    expect(bet.status).toBe(200);
    expect(bet.body.balance.amount).toBe('70.00');
    expect(win.body.balance.amount).toBe('120.00');

    const wallet = await api.getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('120.00');
    expect(wallet.body.version).toBe(3);
  });

  it('não move saldo nem gera lançamento no LOSS', async () => {
    const loss = await api.submit(payload({ walletId, kind: 'LOSS' }), 'k-loss');
    const ledger = await api.getLedger(walletId);

    expect(loss.body.status).toBe('PROCESSED');
    expect(loss.body.balance.amount).toBe('100.00');
    expect(ledger.body.entries).toHaveLength(1);
  });

  it('recusa a aposta sem saldo com 422 e deixa o saldo intacto', async () => {
    const bet = await api.submit(
      payload({ walletId, money: { amount: '150.00', currency: 'BRL' } }),
      'k-sem-saldo',
    );

    expect(bet.status).toBe(422);
    expect(bet.body.status).toBe('REJECTED');
    expect(bet.body.failureCode).toBe('INSUFFICIENT_FUNDS');

    const wallet = await api.getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('100.00');
  });

  it('repete a resposta original quando a mesma chave chega com o mesmo payload', async () => {
    const body = payload({ walletId, money: { amount: '25.00', currency: 'BRL' } });

    const primeira = await api.submit(body, 'k-replay');
    const segunda = await api.submit(body, 'k-replay');

    expect(segunda.body.transactionId).toBe(primeira.body.transactionId);
    expect(segunda.body.idempotentReplay).toBe(true);

    const ledger = await api.getLedger(walletId);
    const debitos = ledger.body.entries.filter((entry) => entry.direction === 'DEBIT');

    expect(debitos).toHaveLength(1);
  });

  it('recusa com 409 a mesma chave com payload diferente', async () => {
    await api.submit(
      payload({ walletId, money: { amount: '25.00', currency: 'BRL' } }),
      'k-conflito',
    );

    const conflito = await api.submit(
      payload({ walletId, money: { amount: '26.00', currency: 'BRL' } }),
      'k-conflito',
    );

    expect(conflito.status).toBe(409);
    expect((conflito.body as unknown as { failureCode: string }).failureCode).toBe(
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('exige o header Idempotency-Key', async () => {
    const semChave = await api.submitWithoutKey(payload({ walletId }));

    expect(semChave.status).toBe(400);
  });

  it('estorna a aposta uma única vez', async () => {
    const bet = payload({ walletId, money: { amount: '40.00', currency: 'BRL' } });

    await api.submit(bet, 'k-bet');

    const refund = payload({
      walletId,
      kind: 'REFUND',
      money: { amount: '40.00', currency: 'BRL' },
      referenceExternalTransactionId: bet.externalTransactionId,
    });

    const primeiro = await api.submit(refund, 'k-refund-1');
    const segundo = await api.submit(
      { ...refund, externalTransactionId: `ext-${crypto.randomUUID()}` },
      'k-refund-2',
    );

    expect(primeiro.body.status).toBe('PROCESSED');
    expect(primeiro.body.balance.amount).toBe('100.00');
    expect(segundo.status).toBe(422);
    expect(segundo.body.failureCode).toBe('REFERENCE_ALREADY_REVERSED');
  });

  it('aceita como pendente o estorno que chega antes da referência', async () => {
    const refund = await api.submit(
      payload({
        walletId,
        kind: 'REFUND',
        money: { amount: '40.00', currency: 'BRL' },
        referenceExternalTransactionId: 'ext-ainda-nao-chegou',
      }),
      'k-pendente',
    );

    expect(refund.status).toBe(202);
    expect(refund.body.status).toBe('PENDING_REFERENCE');
    expect(refund.body.balance.amount).toBe('100.00');
  });

  it('pagina o extrato por cursor estável', async () => {
    for (let i = 0; i < 3; i += 1) {
      await api.submit(payload({ walletId, money: { amount: '5.00', currency: 'BRL' } }), `k-${i}`);
    }

    const primeira = await api.getLedger(walletId, '?limit=2');
    const segunda = await api.getLedger(walletId, `?limit=2&cursor=${primeira.body.nextCursor}`);

    expect(primeira.body.entries).toHaveLength(2);
    expect(primeira.body.nextCursor).toBeString();
    expect(segunda.body.entries).toHaveLength(2);
    expect(segunda.body.nextCursor).toBeUndefined();

    const ids = [...primeira.body.entries, ...segunda.body.entries].map((entry) => entry.id);

    expect(new Set(ids).size).toBe(4);
  });

  it('consulta a transação pelo id e pelo par provider + externalTransactionId', async () => {
    const body = payload({ walletId, money: { amount: '10.00', currency: 'BRL' } });
    const submetida = await api.submit(body, 'k-consulta');

    const porId = await api.getTransaction(submetida.body.transactionId);
    const porExterno = await api.getByExternalId(TEST_PROVIDER, body.externalTransactionId);

    expect(porId.body.status).toBe('PROCESSED');
    expect(porExterno.body.id).toBe(submetida.body.transactionId);
  });

  it('reconcilia sem divergência depois de uma sequência de movimentos', async () => {
    await api.submit(payload({ walletId, money: { amount: '30.00', currency: 'BRL' } }), 'k-1');
    await api.submit(
      payload({ walletId, kind: 'WIN', money: { amount: '12.50', currency: 'BRL' } }),
      'k-2',
    );

    const relatorio = await api.reconcile(walletId);

    expect(relatorio.body.consistent).toBe(true);
    expect(relatorio.body.storedBalance.amount).toBe('82.50');
    expect(relatorio.body.difference.amount).toBe('0.00');
    expect(relatorio.body.checkedEntries).toBe(3);
  });
});
