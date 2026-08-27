export class InvalidLedgerCursorError extends Error {
  constructor(cursor: string) {
    super(`Cursor inválido: ${cursor}`);
    this.name = 'InvalidLedgerCursorError';
  }
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
    throw new InvalidLedgerCursorError(cursor);
  }

  const createdAt = new Date(instant);

  if (Number.isNaN(createdAt.getTime())) {
    throw new InvalidLedgerCursorError(cursor);
  }

  return { createdAt, id };
}
