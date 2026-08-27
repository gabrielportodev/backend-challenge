import { describe, expect, it } from 'bun:test';
import { canonicalJson, hashPayload } from '@shared/payload-hash';

describe('hash do payload', () => {
  it('ignora a ordem das chaves', () => {
    expect(hashPayload({ kind: 'BET', amount: '10.00' })).toBe(
      hashPayload({ amount: '10.00', kind: 'BET' }),
    );
  });

  it('ignora a ordem das chaves aninhadas', () => {
    expect(hashPayload({ money: { amount: '10.00', currency: 'BRL' } })).toBe(
      hashPayload({ money: { currency: 'BRL', amount: '10.00' } }),
    );
  });

  it('preserva a ordem dos arrays', () => {
    expect(canonicalJson({ items: [1, 2] })).not.toBe(canonicalJson({ items: [2, 1] }));
  });

  it('muda quando um valor muda', () => {
    expect(hashPayload({ amount: '10.00' })).not.toBe(hashPayload({ amount: '10.01' }));
  });

  it('trata campo ausente e campo undefined como a mesma coisa', () => {
    expect(hashPayload({ kind: 'BET', reference: undefined })).toBe(hashPayload({ kind: 'BET' }));
  });

  it('devolve sha-256 em hexadecimal', () => {
    expect(hashPayload({ kind: 'BET' })).toMatch(/^[0-9a-f]{64}$/);
  });
});
