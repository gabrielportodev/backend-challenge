import type { FailureCode } from './failure-code';

export abstract class DomainError extends Error {
  abstract readonly failureCode: FailureCode;

  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Entrada malformada: não chega a ser avaliada pelas regras de negócio. */
export abstract class DomainValidationError extends DomainError {}

/** Regra de negócio violada: a transação vira REJECTED e o failureCode vai para o cliente. */
export abstract class BusinessRejectionError extends DomainError {}

/** Invariante quebrada: estado inconsistente, não deve virar resposta de negócio. */
export abstract class DomainInvariantError extends DomainError {}

export class InvalidMoneyError extends DomainValidationError {
  readonly failureCode = 'INVALID_MONEY';
}

export class MissingReferenceError extends DomainValidationError {
  readonly failureCode = 'VALIDATION_FAILED';
}

export class TransactionKindNotAcceptedError extends DomainValidationError {
  readonly failureCode = 'TRANSACTION_KIND_NOT_ACCEPTED';
}

export class CurrencyMismatchError extends BusinessRejectionError {
  readonly failureCode = 'CURRENCY_MISMATCH';

  constructor(expected: string, received: string) {
    super(`Moeda incompatível: esperado ${expected}, recebido ${received}`, { expected, received });
  }
}

export class InsufficientFundsError extends BusinessRejectionError {
  readonly failureCode = 'INSUFFICIENT_FUNDS';
}

export class ReversalWouldOverdrawError extends BusinessRejectionError {
  readonly failureCode = 'REVERSAL_WOULD_OVERDRAW';
}

export class InvalidTransactionStateError extends DomainInvariantError {
  readonly failureCode = 'INVALID_TRANSACTION_STATE';
}

export class UnbalancedLedgerEntryError extends DomainInvariantError {
  readonly failureCode = 'LEDGER_ENTRY_UNBALANCED';
}
