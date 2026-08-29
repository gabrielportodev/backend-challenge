import { Injectable } from '@nestjs/common';
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

export type SubmissionSource = 'http' | 'queue';
export type DuplicateOutcome = 'replay' | 'conflict';
export type RetrySource = 'queue' | 'outbox' | 'database';
export type DeadLetterCause = 'invalid_envelope' | 'max_receives';

/** A submissão é uma transação SQL curta, então o interesse está abaixo de um segundo. */
const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5];

/**
 * O que a aplicação expõe em `/metrics`. Cada ponto de instrumentação chama um método nomeado
 * daqui, então nenhum tipo do prom-client vaza para o use case ou para o worker.
 *
 * O registro é próprio, e não o global do prom-client: cada aplicação levantada nos testes cria
 * o seu, então registrar a mesma métrica de novo não derruba a suíte.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly transactions = new Counter({
    name: 'wagering_transactions_total',
    help: 'Transações que chegaram a um estado definitivo, por tipo e status',
    labelNames: ['kind', 'status'],
    registers: [this.registry],
  });

  private readonly duplicates = new Counter({
    name: 'wagering_duplicate_submissions_total',
    help: 'Submissões duplicadas detectadas, separando replay de conflito de payload',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  private readonly retries = new Counter({
    name: 'wagering_retries_total',
    help: 'Novas tentativas agendadas, por origem',
    labelNames: ['source'],
    registers: [this.registry],
  });

  private readonly deadLettered = new Counter({
    name: 'wagering_dead_lettered_messages_total',
    help: 'Mensagens enviadas para a DLQ, por motivo',
    labelNames: ['cause'],
    registers: [this.registry],
  });

  private readonly lockConflicts = new Counter({
    name: 'wagering_lock_conflicts_total',
    help: 'Transações abortadas por disputa de lock na mesma wallet',
    registers: [this.registry],
  });

  private readonly outboxLag = new Gauge({
    name: 'wagering_outbox_lag_seconds',
    help: 'Idade do evento mais antigo esperando publicação no outbox',
    registers: [this.registry],
  });

  private readonly submissionDuration = new Histogram({
    name: 'wagering_submission_duration_seconds',
    help: 'Duração da submissão de transação, por entrada',
    labelNames: ['source'],
    buckets: DURATION_BUCKETS,
    registers: [this.registry],
  });

  private readonly reconciliations = new Counter({
    name: 'wagering_reconciliations_total',
    help: 'Reconciliações executadas, separando as consistentes das divergentes',
    labelNames: ['result'],
    registers: [this.registry],
  });

  constructor() {
    // Memória, event loop e CPU do processo: separa lentidão da aplicação de lentidão do ambiente.
    collectDefaultMetrics({ register: this.registry });
  }

  /** Só o processamento de verdade conta; o replay já foi contado quando a original passou. */
  transactionSettled(kind: string, status: string): void {
    this.transactions.inc({ kind, status });
  }

  duplicateDetected(outcome: DuplicateOutcome): void {
    this.duplicates.inc({ outcome });
  }

  retryScheduled(source: RetrySource): void {
    this.retries.inc({ source });
  }

  messageDeadLettered(cause: DeadLetterCause): void {
    this.deadLettered.inc({ cause });
  }

  lockConflict(): void {
    this.lockConflicts.inc();
  }

  /** Idade do evento pendente mais antigo; zero quando não há nada esperando publicação. */
  outboxLagSeconds(seconds: number): void {
    this.outboxLag.set(seconds);
  }

  /** Devolve a função que fecha a medição — chamada no sucesso e na falha. */
  startSubmission(source: SubmissionSource): () => void {
    return this.submissionDuration.startTimer({ source });
  }

  reconciliationChecked(consistent: boolean): void {
    this.reconciliations.inc({ result: consistent ? 'consistent' : 'divergent' });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }
}
