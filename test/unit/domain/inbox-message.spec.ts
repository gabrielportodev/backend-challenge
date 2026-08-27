import { describe, expect, it } from 'bun:test';
import { InboxMessage } from '@domain/messaging';

const receivedAt = new Date('2026-01-01T00:00:00.000Z');
const processedAt = new Date('2026-01-01T00:00:01.000Z');

const receive = () =>
  InboxMessage.receive({
    messageId: 'msg-1',
    consumerName: 'wager-transactions',
    payloadHash: 'hash-1',
    receivedAt,
  });

describe('InboxMessage', () => {
  it('nasce não processada', () => {
    const message = receive();

    expect(message.isProcessed()).toBe(false);
    expect(message.processedAt).toBeUndefined();
  });

  it('marca o processamento', () => {
    const message = receive();
    message.markProcessed(processedAt);

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toEqual(processedAt);
  });

  it('preserva o primeiro processamento em redelivery', () => {
    const message = receive();
    message.markProcessed(processedAt);
    message.markProcessed(new Date('2026-01-01T00:00:09.000Z'));

    expect(message.processedAt).toEqual(processedAt);
  });

  it('reidrata o estado persistido', () => {
    const message = InboxMessage.rehydrate({
      messageId: 'msg-1',
      consumerName: 'wager-transactions',
      payloadHash: 'hash-1',
      receivedAt,
      processedAt,
    });

    expect(message.isProcessed()).toBe(true);
    expect(message.payloadHash).toBe('hash-1');
  });
});
