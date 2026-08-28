import 'reflect-metadata';
import { describe, expect, it } from 'bun:test';
import { InboxMessage } from '@modules/messaging/domain/inbox-message.entity';
import { OutboxMessage } from '@modules/messaging/domain/outbox-message.entity';
import {
  inboxToDomain,
  inboxToEntity,
} from '@modules/messaging/infra/mikro-orm/inbox-message.mapper';
import {
  outboxToDomain,
  outboxToEntity,
} from '@modules/messaging/infra/mikro-orm/outbox-message.mapper';
import { WagerTransaction } from '@modules/wagering/domain/wager-transaction.aggregate';
import {
  transactionToDomain,
  transactionToEntity,
} from '@modules/wagering/infra/mikro-orm/wager-transaction.mapper';
import { Wallet } from '@modules/wallet/domain/wallet.aggregate';
import { WalletLedgerEntry } from '@modules/wallet/domain/wallet-ledger-entry.entity';
import { walletToDomain, walletToEntity } from '@modules/wallet/infra/mikro-orm/wallet.mapper';
import { WalletEntity } from '@modules/wallet/infra/mikro-orm/wallet.mikro-entity';
import {
  ledgerEntryToDomain,
  ledgerEntryToEntity,
} from '@modules/wallet/infra/mikro-orm/wallet-ledger-entry.mapper';
import { Money } from '@shared/domain/money';
import { IntegrationEvent } from '@shared/kernel/integration-event';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
const at = new Date('2026-01-01T00:00:00.000Z');
const depois = new Date('2026-01-02T00:00:00.000Z');

const abrirWallet = () =>
  Wallet.open({
    id: '018f2f00-0000-7000-8000-000000000001',
    playerId: 'player-1',
    initialBalance: brl('100.00'),
    openedAt: at,
    openingTransactionId: '018f2f00-0000-7000-8000-000000000002',
    openingLedgerEntryId: '018f2f00-0000-7000-8000-000000000003',
  }).wallet;

const criarTransacao = () =>
  WagerTransaction.create({
    id: '018f2f00-0000-7000-8000-000000000010',
    providerId: 'provider-1',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-1:ext-1',
    payloadHash: 'a'.repeat(64),
    walletId: '018f2f00-0000-7000-8000-000000000001',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: brl('80.00'),
    createdAt: at,
  });

// Evento mínimo só para exercitar a outbox: qualquer subclasse de IntegrationEvent serve.
class EventoDeTeste extends IntegrationEvent<{ valor: string }> {
  readonly eventType = 'EventoDeTeste';
  readonly version = 1;

  constructor() {
    super({
      eventId: '018f2f00-0000-7000-8000-000000000040',
      aggregateId: '018f2f00-0000-7000-8000-000000000001',
      correlationId: 'corr-1',
      occurredAt: at,
      data: { valor: '10.00' },
    });
  }
}

describe('mapper de wallet', () => {
  it('leva a wallet ate a linha e traz de volta sem perder nada', () => {
    const original = abrirWallet();

    const volta = walletToDomain(walletToEntity(original));

    expect(volta.id).toBe(original.id);
    expect(volta.playerId).toBe(original.playerId);
    expect(volta.currency).toBe('BRL');
    expect(volta.balance.toString()).toBe('100.00');
    expect(volta.version).toBe(original.version);
    expect(volta.createdAt).toEqual(at);
    expect(volta.updatedAt).toEqual(at);
  });

  it('grava o saldo como string com duas casas, do jeito que a coluna numeric espera', () => {
    const row = walletToEntity(abrirWallet());

    expect(row.balanceAmount).toBe('100.00');
    expect(typeof row.balanceAmount).toBe('string');
  });

  it('monta uma linha nova quando nao recebe nenhuma', () => {
    expect(walletToEntity(abrirWallet())).toBeInstanceOf(WalletEntity);
  });
});

describe('mapper de transacao', () => {
  it('leva a transacao ate a linha e traz de volta sem perder nada', () => {
    const original = criarTransacao();

    const volta = transactionToDomain(transactionToEntity(original));

    expect(volta.id).toBe(original.id);
    expect(volta.providerId).toBe(original.providerId);
    expect(volta.externalTransactionId).toBe(original.externalTransactionId);
    expect(volta.idempotencyKey).toBe(original.idempotencyKey);
    expect(volta.payloadHash).toBe(original.payloadHash);
    expect(volta.walletId).toBe(original.walletId);
    expect(volta.roundId).toBe(original.roundId);
    expect(volta.gameId).toBe(original.gameId);
    expect(volta.kind).toBe('BET');
    expect(volta.money.toString()).toBe('80.00');
    expect(volta.money.currency).toBe('BRL');
    expect(volta.status).toBe('PENDING');
  });

  it('separa o dinheiro em coluna de valor e coluna de moeda', () => {
    const row = transactionToEntity(criarTransacao());

    expect(row.amount).toBe('80.00');
    expect(row.currency).toBe('BRL');
  });

  it('deixa vazias as colunas opcionais enquanto a transacao esta pendente', () => {
    const row = transactionToEntity(criarTransacao());

    expect(row.referenceExternalTransactionId).toBeUndefined();
    expect(row.referenceTransactionId).toBeUndefined();
    expect(row.failureCode).toBeUndefined();
    expect(row.processedAt).toBeUndefined();
  });

  it('preserva referencia e horario depois de processar', () => {
    const original = criarTransacao();
    original.markProcessed('018f2f00-0000-7000-8000-000000000020', depois);

    const volta = transactionToDomain(transactionToEntity(original));

    expect(volta.status).toBe('PROCESSED');
    expect(volta.referenceTransactionId).toBe('018f2f00-0000-7000-8000-000000000020');
    expect(volta.processedAt).toEqual(depois);
  });

  it('preserva o failureCode de uma rejeicao', () => {
    const original = criarTransacao();
    original.reject('INSUFFICIENT_FUNDS');

    const volta = transactionToDomain(transactionToEntity(original));

    expect(volta.status).toBe('REJECTED');
    expect(volta.failureCode).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('mapper de lancamento', () => {
  const lancamento = () =>
    WalletLedgerEntry.create({
      id: '018f2f00-0000-7000-8000-000000000030',
      walletId: '018f2f00-0000-7000-8000-000000000001',
      transactionId: '018f2f00-0000-7000-8000-000000000010',
      direction: 'DEBIT',
      money: brl('30.00'),
      balanceBefore: brl('100.00'),
      balanceAfter: brl('70.00'),
      createdAt: at,
    });

  it('leva o lancamento ate a linha e traz de volta com a conta ainda fechando', () => {
    const volta = ledgerEntryToDomain(ledgerEntryToEntity(lancamento()));

    expect(volta.direction).toBe('DEBIT');
    expect(volta.money.toString()).toBe('30.00');
    expect(volta.balanceBefore.toString()).toBe('100.00');
    expect(volta.balanceAfter.toString()).toBe('70.00');
    expect(volta.isBalanced()).toBe(true);
  });

  it('usa uma unica coluna de moeda para valor e saldos', () => {
    const row = ledgerEntryToEntity(lancamento());

    expect(row.currency).toBe('BRL');
    expect(row.amount).toBe('30.00');
    expect(row.balanceBeforeAmount).toBe('100.00');
    expect(row.balanceAfterAmount).toBe('70.00');
  });
});

describe('mapper de inbox', () => {
  const recebida = () =>
    InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wager-transactions',
      payloadHash: 'b'.repeat(64),
      receivedAt: at,
    });

  it('leva a mensagem ate a linha e traz de volta ainda nao processada', () => {
    const volta = inboxToDomain(inboxToEntity(recebida()));

    expect(volta.messageId).toBe('msg-1');
    expect(volta.consumerName).toBe('wager-transactions');
    expect(volta.receivedAt).toEqual(at);
    expect(volta.isProcessed()).toBe(false);
  });

  it('preserva o horario do processamento', () => {
    const original = recebida();
    original.markProcessed(depois);

    const volta = inboxToDomain(inboxToEntity(original));

    expect(volta.isProcessed()).toBe(true);
    expect(volta.processedAt).toEqual(depois);
  });
});

describe('mapper de outbox', () => {
  const enfileirada = () => OutboxMessage.enqueue(new EventoDeTeste());

  it('leva a linha da outbox ate o banco e traz de volta com o envelope intacto', () => {
    const volta = outboxToDomain(outboxToEntity(enfileirada()));

    expect(volta.id).toBe('018f2f00-0000-7000-8000-000000000040');
    expect(volta.eventType).toBe('EventoDeTeste');
    expect(volta.payload.data).toEqual({ valor: '10.00' });
    expect(volta.payload.occurredAt).toBe(at.toISOString());
    expect(volta.attempts).toBe(0);
    expect(volta.isPending()).toBe(true);
  });

  it('preserva tentativas e proximo horario depois de agendar retry', () => {
    const original = enfileirada();
    original.scheduleRetry(at);

    const volta = outboxToDomain(outboxToEntity(original));

    expect(volta.attempts).toBe(1);
    expect(volta.nextAttemptAt).toEqual(original.nextAttemptAt);
  });

  // O Postgres devolve null nas colunas vazias, e o domínio só reconhece undefined como pendente.
  it('trata coluna nula vinda do banco como ausente', () => {
    const row = outboxToEntity(enfileirada());
    row.nextAttemptAt = null as unknown as undefined;
    row.publishedAt = null as unknown as undefined;

    const volta = outboxToDomain(row);

    expect(volta.isPending()).toBe(true);
    expect(volta.isDue(at)).toBe(true);
    expect(volta.publishedAt).toBeUndefined();
    expect(volta.nextAttemptAt).toBeUndefined();
  });

  it('preserva a marca de publicada', () => {
    const original = enfileirada();
    original.markPublished(depois);

    const volta = outboxToDomain(outboxToEntity(original));

    expect(volta.isPending()).toBe(false);
    expect(volta.publishedAt).toEqual(depois);
  });
});
