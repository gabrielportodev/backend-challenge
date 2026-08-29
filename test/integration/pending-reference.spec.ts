import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { PendingReferenceWorker } from '@modules/wagering/application/pending-reference.worker';
import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import { WAGER_TRANSACTION_REPOSITORY } from '@modules/wagering/domain/wager-transaction.repository.port';
import type { SubmitTransactionBody } from '@modules/wagering/infra/http/wagering.dto';
import { WALLET_REPOSITORY } from '@modules/wallet/domain/wallet.repository.port';
import { MetricsService } from '@shared/infra/metrics/metrics.service';
import { TRANSACTION_RUNNER } from '@shared/kernel/transaction-runner.port';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';

const UMA_HORA_MS = 3_600_000;

/**
 * Estorno e rollback podem chegar antes da aposta que revertem — a fila não garante ordem entre
 * grupos. Ficam esperando em vez de serem recusados, e um worker tenta de novo.
 */
describe('referência fora de ordem', () => {
  let app: TestApp;
  let api: ApiClient;
  let worker: PendingReferenceWorker;
  let walletId: string;
  let aposta: SubmitTransactionBody;
  let estorno: SubmitTransactionBody;

  const statusDe = async (idempotencyKey: string) => {
    const [linha] = await app.sql<{
      status: string;
      failure_code: string | null;
      reference_attempts: number;
    }>(
      'select status, failure_code, reference_attempts from wager_transactions where idempotency_key = ?',
      [idempotencyKey],
    );

    return linha;
  };

  /** Adianta o relógio a cada varredura: sem isso o backoff faria o teste esperar minutos. */
  const varrer = (vezes: number) =>
    (async () => {
      for (let i = 1; i <= vezes; i += 1) {
        await worker.resolveDue(new Date(Date.now() + i * UMA_HORA_MS));
      }
    })();

  beforeAll(async () => {
    app = await createTestApp();
    api = apiClient(app.url);
    worker = new PendingReferenceWorker(
      app.app.get(TRANSACTION_RUNNER),
      app.app.get(WAGER_TRANSACTION_REPOSITORY),
      app.app.get(WALLET_REPOSITORY),
      app.app.get(WagerSettlement),
      app.app.get(MetricsService),
    );
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await app.reset();

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;
    aposta = payload({ walletId, money: { amount: '40.00', currency: 'BRL' } });
    estorno = payload({
      walletId,
      kind: 'REFUND',
      money: { amount: '40.00', currency: 'BRL' },
      referenceExternalTransactionId: aposta.externalTransactionId,
    });
  });

  afterEach(() => expectStoredBalancesMatchLedger(app.sql));

  it('guarda o estorno como pendente e agenda a próxima tentativa', async () => {
    const resposta = await api.submit(estorno, 'k-refund');

    const [linha] = await app.sql<{ status: string; next_reference_attempt_at: Date | null }>(
      'select status, next_reference_attempt_at from wager_transactions where idempotency_key = ?',
      ['k-refund'],
    );

    expect(resposta.status).toBe(202);
    expect(linha?.status).toBe('PENDING_REFERENCE');
    expect(linha?.next_reference_attempt_at).not.toBeNull();
  });

  it('conclui o estorno quando a aposta referenciada finalmente chega', async () => {
    await api.submit(estorno, 'k-refund');
    await api.submit(aposta, 'k-bet');

    await varrer(1);

    const linha = await statusDe('k-refund');
    const wallet = await api.getWallet(walletId);

    expect(linha?.status).toBe('PROCESSED');
    expect(wallet.body.balance.amount).toBe('100.00');

    const creditos = await app.sql(
      `select id from wallet_ledger_entries where wallet_id = ? and direction = 'CREDIT'`,
      [walletId],
    );

    // Abertura e estorno.
    expect(creditos).toHaveLength(2);
  });

  it('desiste depois de dez tentativas e rejeita com o código da referência inexistente', async () => {
    await api.submit(estorno, 'k-refund');

    await varrer(10);

    const linha = await statusDe('k-refund');

    expect(linha?.status).toBe('REJECTED');
    expect(linha?.failure_code).toBe('REFERENCE_NOT_FOUND');
    expect(Number(linha?.reference_attempts)).toBe(10);

    const eventos = await app.sql<{ event_type: string }>(
      'select event_type from outbox_messages order by occurred_at',
    );

    expect(eventos.map((evento) => evento.event_type)).toContain('WagerTransactionRejected');

    const wallet = await api.getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('100.00');
  });

  it('não mexe no saldo enquanto a referência não aparece', async () => {
    await api.submit(estorno, 'k-refund');

    await varrer(3);

    const wallet = await api.getWallet(walletId);
    const linha = await statusDe('k-refund');

    expect(linha?.status).toBe('PENDING_REFERENCE');
    expect(wallet.body.balance.amount).toBe('100.00');
    expect(wallet.body.version).toBe(1);
  });
});
