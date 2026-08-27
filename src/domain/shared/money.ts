import { DomainError } from '@domain/errors';
import { Decimal } from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

// Precisão alta e expoentes afastados impedem que qualquer valor vire notação científica.
Decimal.set({ precision: 40, toExpNeg: -40, toExpPos: 40 });

// Faixa aceita: até 17 dígitos inteiros e no máximo 2 decimais, o mesmo que NUMERIC(19,2).
const AMOUNT_PATTERN = /^-?\d{1,17}(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_AMOUNT = new Decimal('99999999999999999.99');
const SCALE = 2;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  /** Aceita valor negativo: negate e a releitura do ledger dependem disso. */
  static from(props: MoneyProps): Money {
    const currency = Money.parseCurrency(props.currency);

    if (typeof props.amount !== 'string' || !AMOUNT_PATTERN.test(props.amount)) {
      throw new DomainError(
        'INVALID_MONEY',
        `Valor monetário inválido: ${JSON.stringify(props.amount)}`,
        {
          amount: props.amount,
          currency,
        },
      );
    }

    return new Money(new Decimal(props.amount), currency);
  }

  /** A API e a fila só aceitam valores maiores que zero. */
  static fromPositive(props: MoneyProps): Money {
    const money = Money.from(props);

    if (!money.isPositive()) {
      throw new DomainError(
        'INVALID_MONEY',
        `Valor monetário deve ser positivo: ${money.toString()}`,
        {
          amount: props.amount,
          currency: money.currency,
        },
      );
    }

    return money;
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0), Money.parseCurrency(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return this.build(this.value.plus(other.value));
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return this.build(this.value.minus(other.value));
  }

  negate(): Money {
    return this.build(this.value.negated());
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    // Zero é tratado à parte porque toFixed em -0 devolveria "-0.00".
    return this.value.isZero() ? '0.00' : this.value.toFixed(SCALE);
  }

  /** Cria o Money do resultado de uma conta, barrando valor fora da faixa do banco. */
  private build(value: Decimal): Money {
    if (value.abs().greaterThan(MAX_AMOUNT)) {
      throw new DomainError(
        'INVALID_MONEY',
        `Valor monetário excede a faixa suportada: ${value.toFixed(SCALE)}`,
        { currency: this.currency },
      );
    }

    return new Money(value, this.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `Moeda incompatível: esperado ${this.currency}, recebido ${other.currency}`,
        { expected: this.currency, received: other.currency },
      );
    }
  }

  private static parseCurrency(currency: string): string {
    if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
      throw new DomainError('INVALID_MONEY', `Moeda inválida: ${JSON.stringify(currency)}`, {
        currency,
      });
    }

    return currency;
  }
}
