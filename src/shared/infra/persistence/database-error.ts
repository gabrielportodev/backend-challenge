import {
  ForeignKeyConstraintViolationException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';

// Códigos do Postgres: falha de serialização, deadlock e a classe 08, de conexão.
const RETRYABLE_CODES = ['40001', '40P01'];
const CONNECTION_CLASS = '08';

/** O MikroORM embrulha o erro do driver, então o código do Postgres pode estar em `previous`. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { code, previous } = error as { code?: unknown; previous?: unknown };

  return typeof code === 'string' ? code : errorCode(previous);
}

/** Erro que some se tentar de novo. Violação de unique nunca entra aqui: é replay ou conflito. */
export function isRetryableDatabaseError(error: unknown): boolean {
  const code = errorCode(error);

  if (!code) {
    return false;
  }

  return RETRYABLE_CODES.includes(code) || code.startsWith(CONNECTION_CLASS);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof UniqueConstraintViolationException;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof ForeignKeyConstraintViolationException;
}

/** O UPDATE do saldo não afetou nenhuma linha: a wallet mudou sem passar pelo lock. */
export class StaleWalletVersionError extends Error {
  constructor(
    readonly walletId: string,
    readonly expectedVersion: number,
  ) {
    super(`Wallet ${walletId} mudou fora do lock: version ${expectedVersion} não confere`);
    this.name = 'StaleWalletVersionError';
  }
}
