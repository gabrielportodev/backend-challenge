import { describe, expect, it } from 'bun:test';
import { statusForFailureCode, statusForTransaction } from '@interfaces/http/failure-status';

describe('tabela de status HTTP', () => {
  it('separa payload inválido de rejeição de negócio', () => {
    expect(statusForFailureCode('VALIDATION_FAILED')).toBe(400);
    expect(statusForFailureCode('INVALID_MONEY')).toBe(400);
    expect(statusForFailureCode('INSUFFICIENT_FUNDS')).toBe(422);
  });

  it('trata conflito de identidade como 409', () => {
    expect(statusForFailureCode('IDEMPOTENCY_CONFLICT')).toBe(409);
    expect(statusForFailureCode('EXTERNAL_TRANSACTION_CONFLICT')).toBe(409);
    expect(statusForFailureCode('WALLET_ALREADY_EXISTS')).toBe(409);
  });

  it('só marca como reenviável a falha transitória', () => {
    expect(statusForFailureCode('TRANSIENT_FAILURE')).toBe(503);
    expect(statusForFailureCode('INSUFFICIENT_FUNDS')).not.toBe(503);
  });

  it('não devolve invariante quebrada como culpa do cliente', () => {
    expect(statusForFailureCode('LEDGER_ENTRY_UNBALANCED')).toBe(500);
  });

  it('mantém as duas faltas de saldo no mesmo status, com códigos distintos', () => {
    expect(statusForFailureCode('INSUFFICIENT_FUNDS')).toBe(422);
    expect(statusForFailureCode('REVERSAL_WOULD_OVERDRAW')).toBe(422);
  });

  it('distingue as cinco situações que o desafio exige separar', () => {
    const situations = [
      statusForFailureCode('VALIDATION_FAILED'),
      statusForFailureCode('IDEMPOTENCY_CONFLICT'),
      statusForTransaction('REJECTED'),
      statusForTransaction('PENDING_REFERENCE'),
      statusForFailureCode('TRANSIENT_FAILURE'),
    ];

    expect(new Set(situations).size).toBe(situations.length);
  });

  it('deriva o status da submissão do estado em que a transação terminou', () => {
    expect(statusForTransaction('PROCESSED')).toBe(200);
    expect(statusForTransaction('PENDING_REFERENCE')).toBe(202);
    expect(statusForTransaction('REJECTED')).toBe(422);
  });
});
