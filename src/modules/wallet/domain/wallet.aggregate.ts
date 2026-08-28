import { DomainError } from '@shared/domain/errors';
import { Money, type MoneyProps } from '@shared/domain/money';
import { type LedgerDirection, WalletLedgerEntry } from './wallet-ledger-entry.entity';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  openedAt: Date;
  openingTransactionId: string;
  openingLedgerEntryId: string;
}

export interface OpenedWallet {
  wallet: Wallet;
  /** Ausente quando o saldo inicial é zero: sem movimentação, sem lançamento. */
  openingEntry?: WalletLedgerEntry;
}

/** A wallet como sai do banco, com o saldo em string decimal. */
export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletMovement {
  transactionId: string;
  ledgerEntryId: string;
  money: Money;
  at: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /**
   * Nasce com o saldo inicial já aplicado e version 1: a abertura não conta como
   * movimentação. O crédito de abertura sai como lançamento de OPENING (zero →
   * saldo inicial) para que ledger e saldo continuem batendo desde a criação.
   */
  static open(props: OpenWalletProps): OpenedWallet {
    if (props.initialBalance.isNegative()) {
      throw new DomainError(
        'INVALID_MONEY',
        `Saldo inicial não pode ser negativo: ${props.initialBalance.toString()}`,
        {
          playerId: props.playerId,
        },
      );
    }

    const wallet = new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.openedAt,
      props.openedAt,
    );

    if (props.initialBalance.isZero()) {
      return { wallet };
    }

    const openingEntry = WalletLedgerEntry.create({
      id: props.openingLedgerEntryId,
      walletId: wallet.id,
      transactionId: props.openingTransactionId,
      direction: 'CREDIT',
      money: props.initialBalance,
      balanceBefore: Money.zero(wallet.currency),
      balanceAfter: props.initialBalance,
      createdAt: props.openedAt,
    });

    return { wallet, openingEntry };
  }

  /** Reconstrução a partir do banco: não revalida invariantes. */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from(state.balance),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(movement: WalletMovement): WalletLedgerEntry {
    return this.applyMovement('DEBIT', movement);
  }

  credit(movement: WalletMovement): WalletLedgerEntry {
    return this.applyMovement('CREDIT', movement);
  }

  hasSufficientFunds(money: Money): boolean {
    this.assertSameCurrency(money);
    return !this._balance.isLessThan(money);
  }

  /** Move o saldo e devolve o lançamento correspondente; qualquer falha aborta antes de mutar. */
  private applyMovement(direction: LedgerDirection, movement: WalletMovement): WalletLedgerEntry {
    this.assertSameCurrency(movement.money);

    if (!movement.money.isPositive()) {
      throw new DomainError(
        'INVALID_MONEY',
        `Movimentação exige valor positivo: ${movement.money.toString()}`,
        {
          walletId: this.id,
          transactionId: movement.transactionId,
        },
      );
    }

    const balanceBefore = this._balance;
    const balanceAfter =
      direction === 'DEBIT'
        ? balanceBefore.subtract(movement.money)
        : balanceBefore.add(movement.money);

    if (balanceAfter.isNegative()) {
      throw new DomainError('INSUFFICIENT_FUNDS', 'Movimentação deixaria o saldo negativo', {
        walletId: this.id,
        transactionId: movement.transactionId,
        balance: balanceBefore.toString(),
        requested: movement.money.toString(),
      });
    }

    const entry = WalletLedgerEntry.create({
      id: movement.ledgerEntryId,
      walletId: this.id,
      transactionId: movement.transactionId,
      direction,
      money: movement.money,
      balanceBefore,
      balanceAfter,
      createdAt: movement.at,
    });

    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = movement.at;

    return entry;
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new DomainError(
        'CURRENCY_MISMATCH',
        `Moeda incompatível: esperado ${this.currency}, recebido ${money.currency}`,
        { expected: this.currency, received: money.currency },
      );
    }
  }
}
