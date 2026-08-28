import type { IntegrationEvent, IntegrationEventEnvelope } from '@shared/kernel/integration-event';

const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 300_000;

/** A linha da outbox como fica no banco. */
export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: IntegrationEventEnvelope<unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: IntegrationEventEnvelope<unknown>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  /** Usa o eventId como id da linha: se o evento for publicado duas vezes, é o mesmo id. */
  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON(),
      event.occurredAt,
      0,
    );
  }

  /** Reconstrução a partir do banco: não revalida nada. */
  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  /** O worker só pega a linha se ela ainda está pendente e o retry já venceu. */
  isDue(now: Date): boolean {
    if (!this.isPending()) {
      return false;
    }

    return this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime();
  }

  /** O primeiro publisher que confirmar vence; o segundo não sobrescreve o horário. */
  markPublished(at: Date): void {
    if (this.isPending()) {
      this._publishedAt = at;
      this._nextAttemptAt = undefined;
    }
  }

  /** Backoff exponencial com teto: 5s, 10s, 20s… até no máximo 5 minutos. */
  scheduleRetry(now: Date): void {
    this._attempts += 1;

    const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** (this._attempts - 1), MAX_RETRY_DELAY_MS);

    this._nextAttemptAt = new Date(now.getTime() + delay);
  }
}
