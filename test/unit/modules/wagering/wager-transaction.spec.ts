import { describe, expect, it } from 'bun:test';
import {
  type CreateWagerTransactionProps,
  WagerTransaction,
  type WagerTransactionKind,
} from '@modules/wagering/domain/wager-transaction.aggregate';
import type { LedgerDirection } from '@modules/wallet/domain/wallet-ledger-entry.entity';
import { Money } from '@shared/domain/money';
import { expectFailure } from '@test/support/failure';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const processedAt = new Date('2026-01-02T00:00:00.000Z');

const makeTx = (overrides: Partial<CreateWagerTransactionProps> = {}) =>
  WagerTransaction.create({
    id: 'tx-1',
    providerId: 'provider-1',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-1:ext-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: Money.from({ amount: '80.00', currency: 'BRL' }),
    createdAt,
    ...overrides,
  });

describe('WagerTransaction.create', () => {
  it('nasce em PENDING sem referencia resolvida', () => {
    const tx = makeTx();

    expect(tx.status).toBe('PENDING');
    expect(tx.isTerminal()).toBe(false);
    expect(tx.referenceTransactionId).toBeUndefined();
    expect(tx.failureCode).toBeUndefined();
    expect(tx.processedAt).toBeUndefined();
  });

  it.each(['REFUND', 'ROLLBACK'])('exige referencia para %s', (kind) => {
    expectFailure(() => makeTx({ kind }), 'VALIDATION_FAILED');
    expect(makeTx({ kind, referenceExternalTransactionId: 'ext-0' }).requiresReference()).toBe(
      true,
    );
  });

  it.each(['BET', 'WIN', 'LOSS'])('nao exige referencia para %s', (kind) => {
    expect(makeTx({ kind }).requiresReference()).toBe(false);
  });

  it('aceita referencia opcional em WIN', () => {
    const tx = makeTx({ kind: 'WIN', referenceExternalTransactionId: 'ext-0' });

    expect(tx.referenceExternalTransactionId).toBe('ext-0');
  });

  it.each([['0.00'], ['-1.00']])('rejeita valor %p', (amount) => {
    expectFailure(
      () => makeTx({ money: Money.from({ amount, currency: 'BRL' }) }),
      'INVALID_MONEY',
    );
  });
});

describe('assertExternallySubmittable', () => {
  it('recusa OPENING', () => {
    expectFailure(
      () => WagerTransaction.assertExternallySubmittable('OPENING'),
      'TRANSACTION_KIND_NOT_ACCEPTED',
    );
  });

  it.each(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'])('aceita %s', (kind) => {
    expect(() => WagerTransaction.assertExternallySubmittable(kind)).not.toThrow();
  });
});

describe('transicoes', () => {
  it('marca como processada guardando referencia e horario', () => {
    const tx = makeTx();
    tx.markProcessed('tx-0', processedAt);

    expect(tx.status).toBe('PROCESSED');
    expect(tx.referenceTransactionId).toBe('tx-0');
    expect(tx.processedAt).toEqual(processedAt);
    expect(tx.isTerminal()).toBe(true);
  });

  it('marca como pendente de referencia e depois processa', () => {
    const tx = makeTx({
      kind: 'REFUND',
      referenceExternalTransactionId: 'ext-0',
    });
    tx.markPendingReference(createdAt);

    expect(tx.status).toBe('PENDING_REFERENCE');
    expect(tx.isTerminal()).toBe(false);

    tx.markProcessed('tx-0', processedAt);
    expect(tx.status).toBe('PROCESSED');
  });

  it('tolera reprocessamento do worker mantendo PENDING_REFERENCE', () => {
    const tx = makeTx({
      kind: 'REFUND',
      referenceExternalTransactionId: 'ext-0',
    });
    tx.markPendingReference(createdAt);
    tx.markPendingReference(createdAt);

    expect(tx.status).toBe('PENDING_REFERENCE');
  });

  it('agenda a proxima tentativa com backoff crescente a cada espera', () => {
    const tx = makeTx({ kind: 'REFUND', referenceExternalTransactionId: 'ext-0' });

    tx.markPendingReference(createdAt);
    expect(tx.referenceAttempts).toBe(1);
    expect(tx.nextReferenceAttemptAt).toEqual(new Date(createdAt.getTime() + 30_000));

    tx.markPendingReference(createdAt);
    expect(tx.referenceAttempts).toBe(2);
    expect(tx.nextReferenceAttemptAt).toEqual(new Date(createdAt.getTime() + 60_000));
  });

  it('so fica devida quando o horario da proxima tentativa chega', () => {
    const tx = makeTx({ kind: 'REFUND', referenceExternalTransactionId: 'ext-0' });
    tx.markPendingReference(createdAt);

    expect(tx.isReferenceDue(createdAt)).toBe(false);
    expect(tx.isReferenceDue(new Date(createdAt.getTime() + 30_000))).toBe(true);
  });

  it('nao fica devida quando ja saiu de PENDING_REFERENCE', () => {
    const tx = makeTx({ kind: 'REFUND', referenceExternalTransactionId: 'ext-0' });
    tx.markPendingReference(createdAt);
    tx.markProcessed('tx-0', processedAt);

    expect(tx.isReferenceDue(new Date(createdAt.getTime() + 300_000))).toBe(false);
  });

  it('esgota a janela de espera na decima tentativa', () => {
    const tx = makeTx({ kind: 'REFUND', referenceExternalTransactionId: 'ext-0' });

    for (let attempt = 1; attempt < 10; attempt += 1) {
      tx.markPendingReference(createdAt);
      expect(tx.hasExhaustedReferenceRetries()).toBe(false);
    }

    tx.markPendingReference(createdAt);
    expect(tx.hasExhaustedReferenceRetries()).toBe(true);
    // O backoff para de crescer no teto de 5 minutos.
    expect(tx.nextReferenceAttemptAt).toEqual(new Date(createdAt.getTime() + 300_000));
  });

  it('rejeita guardando o failureCode', () => {
    const tx = makeTx();
    tx.reject('INSUFFICIENT_FUNDS');

    expect(tx.status).toBe('REJECTED');
    expect(tx.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(tx.isTerminal()).toBe(true);
  });

  it('falha guardando o failureCode', () => {
    const tx = makeTx();
    tx.fail('VALIDATION_FAILED');

    expect(tx.status).toBe('FAILED');
    expect(tx.failureCode).toBe('VALIDATION_FAILED');
    expect(tx.isTerminal()).toBe(true);
  });

  const terminals: Array<[string, (tx: WagerTransaction) => void]> = [
    ['PROCESSED', (tx) => tx.markProcessed(undefined, processedAt)],
    ['REJECTED', (tx) => tx.reject('INSUFFICIENT_FUNDS')],
    ['FAILED', (tx) => tx.fail('VALIDATION_FAILED')],
  ];

  const transitions: Array<[string, (tx: WagerTransaction) => void]> = [
    ['markProcessed', (tx) => tx.markProcessed(undefined, processedAt)],
    ['markPendingReference', (tx) => tx.markPendingReference(createdAt)],
    ['reject', (tx) => tx.reject('INSUFFICIENT_FUNDS')],
    ['fail', (tx) => tx.fail('VALIDATION_FAILED')],
  ];

  for (const [terminalName, toTerminal] of terminals) {
    for (const [transitionName, transition] of transitions) {
      it(`recusa ${transitionName} a partir de ${terminalName}`, () => {
        const tx = makeTx();
        toTerminal(tx);

        expectFailure(() => transition(tx), 'INVALID_TRANSACTION_STATE');
      });
    }
  }

  it('preserva o estado terminal apos transicao recusada', () => {
    const tx = makeTx();
    tx.reject('INSUFFICIENT_FUNDS');

    expectFailure(() => tx.markProcessed('tx-0', processedAt), 'INVALID_TRANSACTION_STATE');
    expect(tx.status).toBe('REJECTED');
    expect(tx.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(tx.processedAt).toBeUndefined();
  });
});

describe('consultas de dominio', () => {
  it('LOSS nao afeta saldo', () => {
    expect(makeTx({ kind: 'LOSS' }).affectsBalance()).toBe(false);
  });

  it.each(['BET', 'WIN', 'REFUND'])('%s afeta saldo', (kind) => {
    expect(makeTx({ kind, referenceExternalTransactionId: 'ext-0' }).affectsBalance()).toBe(true);
  });

  it('compara o payloadHash', () => {
    const tx = makeTx();

    expect(tx.matchesPayload('hash-1')).toBe(true);
    expect(tx.matchesPayload('hash-2')).toBe(false);
  });
});

const direcoesFixas: [WagerTransactionKind, LedgerDirection][] = [
  ['BET', 'DEBIT'],
  ['WIN', 'CREDIT'],
  ['OPENING', 'CREDIT'],
  ['REFUND', 'CREDIT'],
];

const direcoesInvertidas: [WagerTransactionKind, LedgerDirection][] = [
  ['BET', 'CREDIT'],
  ['WIN', 'DEBIT'],
  ['REFUND', 'DEBIT'],
];

describe('ledgerDirectionFor', () => {
  it.each(direcoesFixas)('%s tem direcao fixa %s', (kind, direction) => {
    expect(makeTx({ kind, referenceExternalTransactionId: 'ext-0' }).ledgerDirectionFor()).toBe(
      direction,
    );
  });

  it('LOSS nao tem direcao', () => {
    expectFailure(() => makeTx({ kind: 'LOSS' }).ledgerDirectionFor(), 'INVALID_TRANSACTION_STATE');
  });

  it('ROLLBACK sem referencia nao tem direcao', () => {
    const rollback = makeTx({
      kind: 'ROLLBACK',
      referenceExternalTransactionId: 'ext-0',
    });

    expectFailure(() => rollback.ledgerDirectionFor(), 'INVALID_TRANSACTION_STATE');
  });

  it.each(direcoesInvertidas)('ROLLBACK de %s inverte para %s', (referenceKind, direction) => {
    const reference = makeTx({
      id: 'tx-0',
      kind: referenceKind,
      referenceExternalTransactionId: 'ext-00',
    });
    const rollback = makeTx({
      kind: 'ROLLBACK',
      referenceExternalTransactionId: 'ext-0',
    });

    expect(rollback.ledgerDirectionFor(reference)).toBe(direction);
  });
});

describe('WagerTransaction.rehydrate', () => {
  it('reconstroi um estado terminal que create nunca produziria', () => {
    const tx = WagerTransaction.rehydrate({
      id: 'tx-1',
      providerId: 'provider-1',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-1:ext-1',
      payloadHash: 'hash-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '80.00', currency: 'BRL' },
      createdAt,
      status: 'PROCESSED',
      referenceAttempts: 0,
      referenceTransactionId: 'tx-0',
      processedAt,
    });

    expect(tx.status).toBe('PROCESSED');
    expect(tx.isTerminal()).toBe(true);
    expect(tx.money.toString()).toBe('80.00');
  });
});
