import { describe, expect, it } from 'bun:test';
import { CurrencyMismatchError, InvalidMoneyError } from '@domain/errors';
import { Money } from '@domain/shared/money';

const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });

describe('Money.from', () => {
  it('mantem escala fixa de duas casas na serializacao', () => {
    expect(brl('25').toString()).toBe('25.00');
    expect(brl('25.5').toString()).toBe('25.50');
    expect(brl('0.05').toString()).toBe('0.05');
    expect(brl('-0.00').toString()).toBe('0.00');
  });

  it('serializa como MoneyProps', () => {
    expect(brl('25.00').toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  });

  it.each([
    '',
    ' ',
    '25.',
    '.25',
    '1e3',
    '1E3',
    'NaN',
    'Infinity',
    '-Infinity',
    '25.123',
    '+25.00',
    '1,00',
    '25 ',
  ])('rejeita o valor %p', (amount) => {
    expect(() => brl(amount)).toThrow(InvalidMoneyError);
  });

  it('rejeita valores nao string', () => {
    expect(() => Money.from({ amount: 25 as unknown as string, currency: 'BRL' })).toThrow(
      InvalidMoneyError,
    );
  });

  it.each(['', 'BR', 'BRLL', 'brl', '123'])('rejeita a moeda %p', (currency) => {
    expect(() => Money.from({ amount: '1.00', currency })).toThrow(InvalidMoneyError);
  });

  it('preserva precisao em valores grandes', () => {
    expect(brl('99999999999999999.99').toString()).toBe('99999999999999999.99');
  });

  it('rejeita valores acima da faixa suportada', () => {
    expect(() => brl('100000000000000000.00')).toThrow(InvalidMoneyError);
  });
});

describe('Money.fromPositive', () => {
  it('aceita valores positivos', () => {
    expect(Money.fromPositive({ amount: '0.01', currency: 'BRL' }).toString()).toBe('0.01');
  });

  it.each(['0.00', '-1.00'])('rejeita o valor %p', (amount) => {
    expect(() => Money.fromPositive({ amount, currency: 'BRL' })).toThrow(InvalidMoneyError);
  });
});

describe('operacoes', () => {
  it('soma e subtrai sem erro de ponto flutuante', () => {
    expect(brl('0.10').add(brl('0.20')).toString()).toBe('0.30');
    expect(brl('100.00').subtract(brl('80.00')).toString()).toBe('20.00');
    expect(brl('0.30').subtract(brl('0.10')).toString()).toBe('0.20');
  });

  it('permite resultado negativo em subtracao', () => {
    const result = brl('10.00').subtract(brl('30.00'));
    expect(result.toString()).toBe('-20.00');
    expect(result.isNegative()).toBe(true);
  });

  it('nega preservando a moeda', () => {
    expect(brl('25.00').negate().toJSON()).toEqual({ amount: '-25.00', currency: 'BRL' });
  });

  it('nao muta a instancia original', () => {
    const original = brl('100.00');
    original.add(brl('50.00'));
    original.negate();
    expect(original.toString()).toBe('100.00');
  });

  it('estoura a faixa suportada na soma', () => {
    const max = brl('99999999999999999.99');
    expect(() => max.add(brl('0.01'))).toThrow(InvalidMoneyError);
  });
});

describe('comparacoes', () => {
  it('compara valores da mesma moeda', () => {
    expect(brl('80.00').isLessThan(brl('100.00'))).toBe(true);
    expect(brl('100.00').isLessThan(brl('100.00'))).toBe(false);
    expect(brl('100.00').equals(brl('100.00'))).toBe(true);
    expect(brl('0.00').isZero()).toBe(true);
    expect(Money.zero('BRL').toString()).toBe('0.00');
  });

  it('trata moedas diferentes como desiguais sem lancar', () => {
    expect(brl('1.00').equals(Money.from({ amount: '1.00', currency: 'USD' }))).toBe(false);
  });
});

describe('conflito de moeda', () => {
  const usd = Money.from({ amount: '1.00', currency: 'USD' });

  it.each([
    ['add', (m: Money) => m.add(usd)],
    ['subtract', (m: Money) => m.subtract(usd)],
    ['isLessThan', (m: Money) => m.isLessThan(usd)],
  ])('%s lanca CurrencyMismatchError', (_name, operation) => {
    expect(() => operation(brl('10.00'))).toThrow(CurrencyMismatchError);
  });

  it('expoe o failureCode e os detalhes', () => {
    try {
      brl('10.00').add(usd);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CurrencyMismatchError);
      expect((error as CurrencyMismatchError).failureCode).toBe('CURRENCY_MISMATCH');
      expect((error as CurrencyMismatchError).details).toEqual({
        expected: 'BRL',
        received: 'USD',
      });
    }
  });
});
