/**
 * Sinal de que a escrita colidiu com algo que já existe — a chave de idempotência, o
 * externalTransactionId ou a mensagem no inbox. Não é resposta de negócio: quem recebe decide
 * entre devolver o resultado original e apontar conflito.
 */
export class DuplicateTransactionError extends Error {
  constructor(readonly constraint: string) {
    super(`Escrita duplicada barrada por ${constraint}`);
    this.name = 'DuplicateTransactionError';
  }
}
