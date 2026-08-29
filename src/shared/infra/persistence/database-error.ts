import {
  ForeignKeyConstraintViolationException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';

// Códigos do Postgres: falha de serialização, deadlock e a classe 08, de conexão.
const RETRYABLE_CODES = ['40001', '40P01'];
const CONNECTION_CLASS = '08';

/**
 * Quando o banco está fora do ar não existe SQLSTATE: a falha acontece antes, no socket ou no DNS,
 * e chega como erro do Node. Sem estes códigos ela seria classificada como erro interno, e o
 * provedor receberia 500 em vez do 503 que indica reenvio.
 */
const NETWORK_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ETIMEOUT',
  'EAI_AGAIN',
];

/**
 * Com o banco inalcançável o pool também estoura o próprio tempo de espera por uma conexão. Esse
 * erro não traz código algum, então a mensagem é o único sinal disponível.
 */
const POOL_TIMEOUT = 'Timeout acquiring a connection';

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
  if (error instanceof Error && error.message.includes(POOL_TIMEOUT)) {
    return true;
  }

  const code = errorCode(error);

  if (!code) {
    return false;
  }

  return (
    RETRYABLE_CODES.includes(code) ||
    NETWORK_CODES.includes(code) ||
    code.startsWith(CONNECTION_CLASS)
  );
}

/** Disputa pela mesma wallet: falha de serialização ou deadlock, o que a métrica acompanha. */
export function isLockConflict(error: unknown): boolean {
  if (error instanceof StaleWalletVersionError) {
    return true;
  }

  const code = errorCode(error);

  return code !== undefined && RETRYABLE_CODES.includes(code);
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
