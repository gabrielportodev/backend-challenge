import { describe, expect, it } from 'bun:test';
import { isRetryableDatabaseError } from '@shared/infra/persistence/database-error';

describe('classificação de erro do banco', () => {
  it('reconhece falha de serialização e deadlock', () => {
    expect(isRetryableDatabaseError({ code: '40001' })).toBe(true);
    expect(isRetryableDatabaseError({ code: '40P01' })).toBe(true);
  });

  it('reconhece falha de conexão', () => {
    expect(isRetryableDatabaseError({ code: '08006' })).toBe(true);
  });

  it('reconhece o banco inalcançável, que falha no socket antes de ter SQLSTATE', () => {
    expect(isRetryableDatabaseError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isRetryableDatabaseError({ code: 'ETIMEOUT', syscall: 'getaddrinfo' })).toBe(true);
    expect(isRetryableDatabaseError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('reconhece o pool esgotado esperando por conexão, que vem sem código', () => {
    const erro = new Error('Knex: Timeout acquiring a connection. The pool is probably full.');

    expect(isRetryableDatabaseError(erro)).toBe(true);
  });

  it('acha o código dentro do erro embrulhado pelo ORM', () => {
    expect(isRetryableDatabaseError({ previous: { code: '40001' } })).toBe(true);
  });

  it('não tenta de novo violação de unique', () => {
    expect(isRetryableDatabaseError({ code: '23505' })).toBe(false);
  });

  it('aguenta erro sem código', () => {
    expect(isRetryableDatabaseError(new Error('qualquer'))).toBe(false);
    expect(isRetryableDatabaseError(null)).toBe(false);
  });
});
