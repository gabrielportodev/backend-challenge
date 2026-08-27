export const TRANSACTION_RUNNER = 'TransactionRunner';

/**
 * Envolve um bloco de trabalho em uma única transação SQL. Tudo que os repositórios
 * gravarem dentro do callback commita junto ou não commita nada.
 */
export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
}
