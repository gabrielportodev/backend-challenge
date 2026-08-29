import type { FailureCode } from './failure-code';

/**
 * Toda falha de domínio, de validação de entrada a invariante quebrada. Quem diferencia os casos
 * é o `failureCode`: é ele que vai para a resposta da API, para o evento e para a tabela de
 * status HTTP. Uma subclasse por motivo só repetiria a informação que o código já carrega.
 */
export class DomainError extends Error {
  constructor(
    readonly failureCode: FailureCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Usada em vários pontos, então a mensagem sai de um lugar só. */
export function walletNotFound(walletId: string): DomainError {
  return new DomainError('WALLET_NOT_FOUND', `Wallet não encontrada: ${walletId}`, { walletId });
}
