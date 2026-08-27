import { describe, expect, it } from 'bun:test';
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
  InvalidLedgerCursorError,
} from '@infrastructure/persistence/repositories/ledger-cursor';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const id = '018f2f00-0000-7000-8000-000000000001';

describe('cursor do ledger', () => {
  it('volta ao mesmo instante e id', () => {
    const decoded = decodeLedgerCursor(encodeLedgerCursor({ createdAt, id }));

    expect(decoded.createdAt).toEqual(createdAt);
    expect(decoded.id).toBe(id);
  });

  it('não expõe o formato interno', () => {
    const cursor = encodeLedgerCursor({ createdAt, id });

    expect(cursor).not.toContain(id);
    expect(cursor).not.toContain('|');
  });

  it('recusa cursor que não decodifica', () => {
    expect(() => decodeLedgerCursor('nao-e-um-cursor')).toThrow(InvalidLedgerCursorError);
  });

  it('recusa cursor com data inválida', () => {
    const cursor = Buffer.from(`ontem|${id}`).toString('base64url');

    expect(() => decodeLedgerCursor(cursor)).toThrow(InvalidLedgerCursorError);
  });
});
