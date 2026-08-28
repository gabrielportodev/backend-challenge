import type { WagerTransactionStatus } from '@modules/wagering/domain/wager-transaction.aggregate';
import { HttpStatus } from '@nestjs/common';

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
