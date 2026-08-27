import { describe, expect, it } from 'bun:test';
import { IntegrationEvent } from '@domain/events';
import { OutboxMessage } from '@domain/messaging';

const occurredAt = new Date('2026-01-01T00:00:00.000Z');

// Evento mínimo só para exercitar a outbox: qualquer subclasse de IntegrationEvent serve.
class TestEvent extends IntegrationEvent<{ valor: string }> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  constructor() {
    super({
      eventId: 'event-1',
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      occurredAt,
      data: { valor: '100.00' },
    });
  }
}

const event = () => new TestEvent();

describe('OutboxMessage.enqueue', () => {
  it('copia identidade e envelope do evento', () => {
    const message = OutboxMessage.enqueue(event());

    expect(message.id).toBe('event-1');
    expect(message.aggregateId).toBe('wallet-1');
    expect(message.eventType).toBe('TestEvent');
    expect(message.payload.eventType).toBe('TestEvent');
    expect(message.attempts).toBe(0);
  });

  it('nasce pendente e elegível para publicação imediata', () => {
    const message = OutboxMessage.enqueue(event());

    expect(message.isPending()).toBe(true);
    expect(message.isDue(occurredAt)).toBe(true);
  });
});

describe('OutboxMessage retry e publicação', () => {
  it('agenda backoff exponencial a cada tentativa', () => {
    const message = OutboxMessage.enqueue(event());

    message.scheduleRetry(occurredAt);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt?.getTime()).toBe(occurredAt.getTime() + 5_000);

    message.scheduleRetry(occurredAt);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt?.getTime()).toBe(occurredAt.getTime() + 10_000);
  });

  it('limita o backoff ao teto', () => {
    const message = OutboxMessage.enqueue(event());

    for (let attempt = 0; attempt < 20; attempt += 1) {
      message.scheduleRetry(occurredAt);
    }

    expect(message.nextAttemptAt?.getTime()).toBe(occurredAt.getTime() + 300_000);
  });

  it('não é elegível antes do próximo agendamento', () => {
    const message = OutboxMessage.enqueue(event());
    message.scheduleRetry(occurredAt);

    expect(message.isDue(occurredAt)).toBe(false);
    expect(message.isDue(new Date(occurredAt.getTime() + 5_000))).toBe(true);
  });

  it('deixa de ser pendente após publicar', () => {
    const message = OutboxMessage.enqueue(event());
    const publishedAt = new Date(occurredAt.getTime() + 1_000);
    message.markPublished(publishedAt);

    expect(message.isPending()).toBe(false);
    expect(message.publishedAt).toEqual(publishedAt);
    expect(message.isDue(publishedAt)).toBe(false);
  });

  it('ignora publicação repetida vinda de outro publisher', () => {
    const message = OutboxMessage.enqueue(event());
    const publishedAt = new Date(occurredAt.getTime() + 1_000);
    message.markPublished(publishedAt);
    message.markPublished(new Date(occurredAt.getTime() + 9_000));

    expect(message.publishedAt).toEqual(publishedAt);
  });
});
