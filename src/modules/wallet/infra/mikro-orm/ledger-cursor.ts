import { DomainError } from '@shared/domain/errors';

// O cursor vem da query string, então cursor quebrado é entrada inválida, e não erro interno.
function invalidCursor(cursor: string): DomainError {
  return new DomainError('VALIDATION_FAILED', `Cursor inválido: ${cursor}`, { cursor });
}

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

/**
 * Cursor opaco: base64 de "createdAt|id". O id entra junto porque dois lançamentos podem
 * ter o mesmo instante — sem ele a paginação pularia ou repetiria linhas. É estável porque
 * aponta para uma posição, e não para um deslocamento que muda a cada insert concorrente.
 */
export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString('base64url');
}

export function decodeLedgerCursor(cursor: string): LedgerCursor {
  const [instant, id] = Buffer.from(cursor, 'base64url').toString().split('|');

  if (!instant || !id) {
    throw invalidCursor(cursor);
  }

  const createdAt = new Date(instant);

  if (Number.isNaN(createdAt.getTime())) {
    throw invalidCursor(cursor);
  }

  return { createdAt, id };
}
