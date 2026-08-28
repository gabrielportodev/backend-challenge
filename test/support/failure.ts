import { expect } from 'bun:test';
import { DomainError, type FailureCode } from '@shared/domain/errors';

/**
 * Confere que a falha veio do domínio e com o código esperado. Assertar o `failureCode` em vez do
 * tipo do erro é o que o cliente enxerga, então é o que o teste precisa garantir.
 */
export function expectFailure(run: () => unknown, code: FailureCode): DomainError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).failureCode).toBe(code);

    return error as DomainError;
  }

  throw new Error(`Esperava falhar com ${code}, mas nada foi lançado`);
}

/** A mesma asserção para o caminho assíncrono. */
export async function expectRejection(
  promise: Promise<unknown>,
  code: FailureCode,
): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).failureCode).toBe(code);

    return error as DomainError;
  }

  throw new Error(`Esperava falhar com ${code}, mas a promessa resolveu`);
}
