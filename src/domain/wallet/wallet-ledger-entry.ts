import { InvalidMoneyError, UnbalancedLedgerEntryError } from '@domain/errors';
import { Money, type MoneyProps } from '@domain/shared/money';

export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

/** O mesmo lançamento como sai do banco, com o dinheiro em string decimal. */
export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}

  /** Valida a conta do lançamento: um lançamento torto nunca chega a existir. */
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    if (!props.money.isPositive()) {
      throw new InvalidMoneyError(`Lançamento exige valor positivo: ${props.money.toString()}`, {
        transactionId: props.transactionId,
        walletId: props.walletId,
      });
    }

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError('Aritmética do lançamento não fecha', {
        transactionId: props.transactionId,
        walletId: props.walletId,
        direction: props.direction,
        money: props.money.toString(),
        balanceBefore: props.balanceBefore.toString(),
        balanceAfter: props.balanceAfter.toString(),
      });
    }

    return entry;
  }

  /** Reconstrução a partir do banco: não revalida, para a reconciliação enxergar inconsistência. */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      Money.from(state.money),
      Money.from(state.balanceBefore),
      Money.from(state.balanceAfter),
      state.createdAt,
    );
  }

  /** balanceBefore mais ou menos money precisa dar exatamente balanceAfter. */
  isBalanced(): boolean {
    const expected =
      this.direction === 'DEBIT'
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);

    return expected.equals(this.balanceAfter);
  }
}
