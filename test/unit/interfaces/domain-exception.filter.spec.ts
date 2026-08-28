import { beforeEach, describe, expect, it } from 'bun:test';
import { DuplicateTransactionError } from '@application/errors';
import { DomainError } from '@domain/errors';
import { StaleWalletVersionError } from '@infrastructure/persistence/database-error';
import {
  DomainExceptionFilter,
  type ErrorResponseBody,
} from '@interfaces/http/domain-exception.filter';
import type { ArgumentsHost } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';

const CORRELATION_ID = '018f2f00-0000-7000-8000-0000000000aa';

class FakeResponse {
  statusCode?: number;
  body?: ErrorResponseBody;
  readonly headers = new Map<string, string>();

  status(code: number): FakeResponse {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): void {
    this.body = body as ErrorResponseBody;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  getHeader(name: string): unknown {
    return name === 'x-correlation-id' ? CORRELATION_ID : this.headers.get(name);
  }
}

const silentLogger = {
  setContext: () => {},
  warn: () => {},
  error: () => {},
} as unknown as PinoLogger;

describe('filtro global de exceções', () => {
  let response: FakeResponse;
  let filter: DomainExceptionFilter;

  const host = (): ArgumentsHost =>
    ({ switchToHttp: () => ({ getResponse: () => response }) }) as unknown as ArgumentsHost;

  const capture = (exception: unknown): ErrorResponseBody => {
    filter.catch(exception, host());

    if (!response.body) {
      throw new Error('o filtro não respondeu');
    }

    return response.body;
  };

  beforeEach(() => {
    response = new FakeResponse();
    filter = new DomainExceptionFilter(silentLogger);
  });

  it('traduz DomainError pelo failureCode', () => {
    const body = capture(
      new DomainError('IDEMPOTENCY_CONFLICT', 'chave reutilizada', { providerId: 'provider-a' }),
    );

    expect(response.statusCode).toBe(409);
    expect(body.failureCode).toBe('IDEMPOTENCY_CONFLICT');
    expect(body.details).toEqual({ providerId: 'provider-a' });
  });

  it('devolve o correlationId da requisição', () => {
    const body = capture(new DomainError('WALLET_NOT_FOUND', 'não achei'));

    expect(response.statusCode).toBe(404);
    expect(body.correlationId).toBe(CORRELATION_ID);
  });

  it('marca falha transitória como reenviável', () => {
    const body = capture(new StaleWalletVersionError('wallet-1', 3));

    expect(response.statusCode).toBe(503);
    expect(body.failureCode).toBe('TRANSIENT_FAILURE');
    expect(response.headers.get('Retry-After')).toBe('1');
  });

  it('reconhece erro de banco retentável pelo código do Postgres', () => {
    const body = capture(Object.assign(new Error('serialization failure'), { code: '40001' }));

    expect(response.statusCode).toBe(503);
    expect(body.failureCode).toBe('TRANSIENT_FAILURE');
  });

  it('não marca conflito de escrita como reenviável', () => {
    const body = capture(new DuplicateTransactionError('wager_transactions'));

    expect(response.statusCode).toBe(409);
    expect(body.failureCode).toBe('DUPLICATE_SUBMISSION');
    expect(response.headers.has('Retry-After')).toBe(false);
  });

  it('preserva o status das recusas do próprio framework', () => {
    const body = capture(new NotFoundException());

    expect(response.statusCode).toBe(404);
    expect(body.failureCode).toBe('REQUEST_FAILED');
  });

  it('não vaza detalhe de erro desconhecido', () => {
    const body = capture(new Error('connection string: postgres://user:senha@host'));

    expect(response.statusCode).toBe(500);
    expect(body.failureCode).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('senha');
  });
});
