import { beforeEach, describe, expect, it } from 'bun:test';
import type { HttpResponse } from '@shared/infra/http/http-response';
import { MetricsController } from '@shared/infra/metrics/metrics.controller';
import { MetricsService } from '@shared/infra/metrics/metrics.service';

let metrics: MetricsService;

beforeEach(() => {
  metrics = new MetricsService();
});

/** Só o que o controller usa: guarda o header para o teste conferir o formato anunciado. */
class FakeResponse implements HttpResponse {
  readonly headers: Record<string, string> = {};

  status(): HttpResponse {
    return this;
  }

  json(): void {}

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getHeader(name: string): unknown {
    return this.headers[name];
  }
}

describe('MetricsService', () => {
  it('separa as transações por tipo e status', async () => {
    metrics.transactionSettled('BET', 'PROCESSED');
    metrics.transactionSettled('BET', 'REJECTED');
    metrics.transactionSettled('BET', 'PROCESSED');

    const scrape = await metrics.scrape();

    expect(scrape).toContain('wagering_transactions_total{kind="BET",status="PROCESSED"} 2');
    expect(scrape).toContain('wagering_transactions_total{kind="BET",status="REJECTED"} 1');
  });

  it('distingue replay de conflito na contagem de duplicatas', async () => {
    metrics.duplicateDetected('replay');
    metrics.duplicateDetected('conflict');

    const scrape = await metrics.scrape();

    expect(scrape).toContain('wagering_duplicate_submissions_total{outcome="replay"} 1');
    expect(scrape).toContain('wagering_duplicate_submissions_total{outcome="conflict"} 1');
  });

  it('separa a origem do retry', async () => {
    metrics.retryScheduled('queue');
    metrics.retryScheduled('database');

    const scrape = await metrics.scrape();

    expect(scrape).toContain('wagering_retries_total{source="queue"} 1');
    expect(scrape).toContain('wagering_retries_total{source="database"} 1');
  });

  it('registra DLQ, conflito de lock e outbox lag', async () => {
    metrics.messageDeadLettered('invalid_envelope');
    metrics.lockConflict();
    metrics.outboxLagSeconds(12.5);

    const scrape = await metrics.scrape();

    expect(scrape).toContain('wagering_dead_lettered_messages_total{cause="invalid_envelope"} 1');
    expect(scrape).toContain('wagering_lock_conflicts_total 1');
    expect(scrape).toContain('wagering_outbox_lag_seconds 12.5');
  });

  it('mede a latência da submissão pela entrada que a originou', async () => {
    metrics.startSubmission('http')();

    const scrape = await metrics.scrape();

    expect(scrape).toContain('wagering_submission_duration_seconds_count{source="http"} 1');
  });

  it('conta a reconciliação divergente à parte da consistente', async () => {
    metrics.reconciliationChecked(true);
    metrics.reconciliationChecked(false);

    const scrape = await metrics.scrape();

    expect(scrape).toContain('wagering_reconciliations_total{result="consistent"} 1');
    expect(scrape).toContain('wagering_reconciliations_total{result="divergent"} 1');
  });
});

describe('MetricsController', () => {
  it('anuncia o formato que o Prometheus espera', async () => {
    const response = new FakeResponse();
    const body = await new MetricsController(metrics).scrape(response);

    expect(response.headers['Content-Type']).toBe(metrics.contentType);
    expect(body).toContain('wagering_transactions_total');
  });
});
