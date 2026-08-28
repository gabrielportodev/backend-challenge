import type { FailureCode } from '@domain/errors';
import type { WagerTransactionStatus } from '@domain/wagering/wager-transaction';
import { HttpStatus } from '@nestjs/common';

/**
 * A borda precisa nomear o que o domínio não nomeia: colisão de escrita sem dono identificado,
 * falha transitória, recusa do próprio framework e erro nosso. Fora esses quatro, o código que
 * chega ao cliente é o mesmo `failureCode` que viaja no evento e no banco.
 */
export type HttpFailureCode =
  | FailureCode
  | 'DUPLICATE_SUBMISSION'
  | 'TRANSIENT_FAILURE'
  | 'REQUEST_FAILED'
  | 'INTERNAL_ERROR';

/**
 * Um status por código, num lugar só. A separação que importa: 400 é payload que não dá para
 * ler, 409 é conflito de identidade, 422 é pedido entendido e recusado por regra de negócio, e
 * 503 é falha que passa — só nesse último o provedor pode reenviar o mesmo pedido.
 */
const STATUS_BY_FAILURE_CODE: Record<HttpFailureCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  INVALID_MONEY: HttpStatus.BAD_REQUEST,
  REQUEST_FAILED: HttpStatus.BAD_REQUEST,

  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  TRANSACTION_NOT_FOUND: HttpStatus.NOT_FOUND,

  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  EXTERNAL_TRANSACTION_CONFLICT: HttpStatus.CONFLICT,
  DUPLICATE_SUBMISSION: HttpStatus.CONFLICT,

  CURRENCY_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  INSUFFICIENT_FUNDS: HttpStatus.UNPROCESSABLE_ENTITY,
  REVERSAL_WOULD_OVERDRAW: HttpStatus.UNPROCESSABLE_ENTITY,
  WALLET_PLAYER_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_NOT_FOUND: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_NOT_PROCESSED: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_KIND_NOT_REVERSIBLE: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_AMOUNT_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_ALREADY_REVERSED: HttpStatus.UNPROCESSABLE_ENTITY,
  TRANSACTION_KIND_NOT_ACCEPTED: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_TRANSACTION_STATE: HttpStatus.UNPROCESSABLE_ENTITY,

  TRANSIENT_FAILURE: HttpStatus.SERVICE_UNAVAILABLE,

  // Invariante nossa quebrada: não há nada que o cliente possa corrigir no pedido.
  LEDGER_ENTRY_UNBALANCED: HttpStatus.INTERNAL_SERVER_ERROR,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

export function statusForFailureCode(failureCode: HttpFailureCode): HttpStatus {
  return STATUS_BY_FAILURE_CODE[failureCode];
}

// Rejeição de negócio não vira exceção: a transação é gravada, auditada e devolvida.
const STATUS_BY_TRANSACTION_STATUS: Record<WagerTransactionStatus, HttpStatus> = {
  PROCESSED: HttpStatus.OK,
  REJECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  // Aceita e persistida, mas ainda sem desfecho: quem conclui é o worker de referência.
  PENDING_REFERENCE: HttpStatus.ACCEPTED,
  PENDING: HttpStatus.ACCEPTED,
  FAILED: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * O status de uma submissão sai do estado em que a transação terminou, e não de exceção: é o que
 * separa aceite, aceite pendente e recusa sem o provedor ter que interpretar mensagem.
 */
export function statusForTransaction(status: WagerTransactionStatus): HttpStatus {
  return STATUS_BY_TRANSACTION_STATUS[status];
}
