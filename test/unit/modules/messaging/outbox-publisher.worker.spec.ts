import { describe, expect, it } from 'bun:test';
import { OutboxPublisherWorker } from '@modules/messaging/application/outbox-publisher.worker';
import type {
  MessagePublisherPort,
  OutgoingMessage,
} from '@modules/messaging/domain/message-publisher.port';
import { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import { MetricsService } from '@shared/infra/metrics/metrics.service';
import { IntegrationEvent } from '@shared/kernel/integration-event';
import { ImmediateTransactionRunner, InMemoryOutboxRepository } from '@test/support/fakes';

const now = new Date('2026-01-01T00:00:00.000Z');

class TestEvent extends IntegrationEvent<{ valor: string }> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  constructor(eventId: string) {
    super({
      eventId,
      aggregateId: 'wallet-1',
      correlationId: 'corr-1',
      occurredAt: now,
      data: { valor: '100.00' },
    });
  }
}

class FakePublisher implements MessagePublisherPort {
  readonly sent: OutgoingMessage[] = [];

  async publish(message: OutgoingMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** Falha sempre: é o publisher indisponível, não um erro de programação. */
class BrokenPublisher implements MessagePublisherPort {
  async publish(): Promise<void> {
    throw new Error('fila indisponível');
  }
}

function setup(publisher: MessagePublisherPort, ids: string[]) {
  const outbox = new InMemoryOutboxRepository();

  for (const id of ids) {
    void outbox.enqueue(OutboxMessage.enqueue(new TestEvent(id)));
  }

  const worker = new OutboxPublisherWorker(
    new ImmediateTransactionRunner(),
    outbox,
    publisher,
    new MetricsService(),
  );

  return { outbox, worker };
}

describe('OutboxPublisherWorker', () => {
  it('publica os pendentes e marca cada linha como publicada', async () => {
    const publisher = new FakePublisher();
    const { outbox, worker } = setup(publisher, ['event-1', 'event-2']);

    const total = await worker.publishPending(now);

    expect(total).toBe(2);
    expect(publisher.sent.map((message) => message.id)).toEqual(['event-1', 'event-2']);
    expect(
      outbox.messages.every((message) => message.publishedAt?.getTime() === now.getTime()),
    ).toBe(true);
  });

  it('envia o envelope serializado, com o eventId como dedup e a wallet como grupo', async () => {
    const publisher = new FakePublisher();
    const { worker } = setup(publisher, ['event-1']);

    await worker.publishPending(now);

    const [sent] = publisher.sent;

    expect(sent?.id).toBe('event-1');
    expect(sent?.groupId).toBe('wallet-1');
    expect(JSON.parse(sent?.body ?? '')).toMatchObject({
      eventId: 'event-1',
      eventType: 'TestEvent',
      version: 1,
      data: { valor: '100.00' },
    });
  });

  it('adia o retry quando a publicação falha, sem marcar como publicada', async () => {
    const { outbox, worker } = setup(new BrokenPublisher(), ['event-1']);

    await worker.publishPending(now);

    const [message] = outbox.messages;

    expect(message?.publishedAt).toBeUndefined();
    expect(message?.attempts).toBe(1);
    expect(message?.isDue(now)).toBe(false);
  });

  it('não republica o que já foi publicado', async () => {
    const publisher = new FakePublisher();
    const { worker } = setup(publisher, ['event-1']);

    await worker.publishPending(now);
    await worker.publishPending(now);

    expect(publisher.sent).toHaveLength(1);
  });

  it('abre uma transação por varredura, para o lote inteiro', async () => {
    const runner = new ImmediateTransactionRunner();
    const outbox = new InMemoryOutboxRepository();

    await outbox.enqueue(OutboxMessage.enqueue(new TestEvent('event-1')));
    await outbox.enqueue(OutboxMessage.enqueue(new TestEvent('event-2')));

    await new OutboxPublisherWorker(
      runner,
      outbox,
      new FakePublisher(),
      new MetricsService(),
    ).publishPending(now);

    expect(runner.runs).toBe(1);
  });
});
