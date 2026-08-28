import { describe, expect, it } from 'bun:test';
import { idempotencyKeySchema, submitTransactionSchema } from '@interfaces/http/dto/wagering.dto';
import {
  createWalletSchema,
  ledgerQuerySchema,
  walletIdSchema,
} from '@interfaces/http/dto/wallet.dto';
import { ZodValidationPipe } from '@interfaces/http/support/zod-validation.pipe';
import { expectFailure } from '@test/support/failure';

const validPayload = {
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  playerId: 'player-1',
  walletId: '018f2f00-0000-7000-8000-000000000001',
  roundId: 'round-987',
  gameId: 'fortune-chimp',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};

describe('validação da borda', () => {
  it('recusa dinheiro como number', () => {
    const pipe = new ZodValidationPipe(submitTransactionSchema);

    expectFailure(
      () => pipe.transform({ ...validPayload, money: { amount: 25, currency: 'BRL' } }),
      'VALIDATION_FAILED',
    );
  });

  it('recusa valor negativo e moeda fora do padrão ISO', () => {
    const pipe = new ZodValidationPipe(submitTransactionSchema);

    expectFailure(
      () => pipe.transform({ ...validPayload, money: { amount: '-25.00', currency: 'BRL' } }),
      'VALIDATION_FAILED',
    );
    expectFailure(
      () => pipe.transform({ ...validPayload, money: { amount: '25.00', currency: 'brl' } }),
      'VALIDATION_FAILED',
    );
  });

  it('aceita uma ou duas casas decimais', () => {
    expect(submitTransactionSchema.parse({ ...validPayload }).money.amount).toBe('25.00');
    expect(
      submitTransactionSchema.parse({ ...validPayload, money: { amount: '25.0', currency: 'BRL' } })
        .money.amount,
    ).toBe('25.0');
  });

  it('recusa mais de duas casas decimais', () => {
    const pipe = new ZodValidationPipe(submitTransactionSchema);

    expectFailure(
      () => pipe.transform({ ...validPayload, money: { amount: '25.001', currency: 'BRL' } }),
      'VALIDATION_FAILED',
    );
  });

  it('não aceita OPENING pela borda', () => {
    const pipe = new ZodValidationPipe(submitTransactionSchema);

    expectFailure(() => pipe.transform({ ...validPayload, kind: 'OPENING' }), 'VALIDATION_FAILED');
  });

  it('diz qual campo caiu', () => {
    const pipe = new ZodValidationPipe(submitTransactionSchema);
    const error = expectFailure(
      () => pipe.transform({ ...validPayload, roundId: '' }),
      'VALIDATION_FAILED',
    );

    expect(JSON.stringify(error.details)).toContain('roundId');
  });

  it('exige Idempotency-Key presente e não vazio', () => {
    const pipe = new ZodValidationPipe(idempotencyKeySchema);

    expectFailure(() => pipe.transform(undefined), 'VALIDATION_FAILED');
    expectFailure(() => pipe.transform(''), 'VALIDATION_FAILED');
    expect(pipe.transform('provider-a:transaction-123')).toBe('provider-a:transaction-123');
  });

  it('exige saldo inicial em string decimal na criação de wallet', () => {
    const pipe = new ZodValidationPipe(createWalletSchema);

    expectFailure(
      () =>
        pipe.transform({ playerId: 'player-1', initialBalance: { amount: 1000, currency: 'BRL' } }),
      'VALIDATION_FAILED',
    );
    expect(
      pipe.transform({ playerId: 'player-1', initialBalance: { amount: '0.00', currency: 'BRL' } })
        .initialBalance.amount,
    ).toBe('0.00');
  });

  it('recusa walletId que não é UUID', () => {
    const pipe = new ZodValidationPipe(walletIdSchema);

    expectFailure(() => pipe.transform('nao-e-uuid'), 'VALIDATION_FAILED');
  });

  it('converte o limit da query string e recusa o que não é número', () => {
    const pipe = new ZodValidationPipe(ledgerQuerySchema);

    expect(pipe.transform({ limit: '10' })).toEqual({ limit: 10 });
    expect(pipe.transform({})).toEqual({});
    expectFailure(() => pipe.transform({ limit: 'dez' }), 'VALIDATION_FAILED');
  });
});
