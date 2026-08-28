import type { LedgerDirection } from '@modules/wallet/domain/wallet-ledger-entry.entity';
import { DomainError, type FailureCode } from '@shared/domain/errors';
import { Money, type MoneyProps } from '@shared/domain/money';

export type WagerTransactionKind = 'OPENING' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

export type WagerTransactionStatus =
  | 'PENDING'
  | 'PENDING_REFERENCE'
  | 'PROCESSED'
  | 'REJECTED'
  | 'FAILED';

const TERMINAL_STATUSES: WagerTransactionStatus[] = ['PROCESSED', 'REJECTED', 'FAILED'];
const KINDS_REQUIRING_REFERENCE: WagerTransactionKind[] = ['REFUND', 'ROLLBACK'];
const CREDIT_KINDS: WagerTransactionKind[] = ['OPENING', 'WIN', 'REFUND'];

/**
 * Uma reversão que chega antes da referência espera por ela. São 10 tentativas com backoff de
 * 30s, 60s, 120s… até o teto de 5 minutos — pouco mais de meia hora de janela. Tempo de sobra
 * para a fila drenar um atraso, e curto o bastante para o provedor receber uma resposta em vez
 * de ficar com dinheiro parado em limbo.
 */
const MAX_REFERENCE_ATTEMPTS = 10;
const BASE_REFERENCE_RETRY_MS = 30_000;
const MAX_REFERENCE_RETRY_MS = 300_000;

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

/** A transação como fica no banco: os dados de criação mais o que muda com o tempo. */
export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  referenceAttempts: number;
  nextReferenceAttemptAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _referenceAttempts = 0,
    private _nextReferenceAttemptAt?: Date,
  ) {}

  /** Nasce em PENDING e exige referência nos tipos que revertem outra transação. */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new DomainError(
        'INVALID_MONEY',
        `Transação exige valor positivo: ${props.money.toString()}`,
        {
          externalTransactionId: props.externalTransactionId,
        },
      );
    }

    if (KINDS_REQUIRING_REFERENCE.includes(props.kind) && !props.referenceExternalTransactionId) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `${props.kind} exige referenceExternalTransactionId`,
        {
          externalTransactionId: props.externalTransactionId,
          kind: props.kind,
        },
      );
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      'PENDING',
    );
  }

  /** Reconstrução a partir do banco: aceita qualquer status, não revalida transições. */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.referenceAttempts,
      state.nextReferenceAttemptAt,
    );
  }

  /** OPENING só nasce internamente: a API e a fila precisam recusar esse tipo. */
  static assertExternallySubmittable(kind: WagerTransactionKind): void {
    if (kind === 'OPENING') {
      throw new DomainError(
        'TRANSACTION_KIND_NOT_ACCEPTED',
        `Tipo de transação não aceito na borda: ${kind}`,
        {
          kind,
        },
      );
    }
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal('PROCESSED');
    this._status = 'PROCESSED';
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  /** Fica esperando a referência e já agenda quando o worker deve tentar de novo. */
  markPendingReference(at: Date): void {
    this.assertNotTerminal('PENDING_REFERENCE');
    this._status = 'PENDING_REFERENCE';
    this._referenceAttempts += 1;

    const delay = Math.min(
      BASE_REFERENCE_RETRY_MS * 2 ** (this._referenceAttempts - 1),
      MAX_REFERENCE_RETRY_MS,
    );

    this._nextReferenceAttemptAt = new Date(at.getTime() + delay);
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal('REJECTED');
    this._status = 'REJECTED';
    this._failureCode = code;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal('FAILED');
    this._status = 'FAILED';
    this._failureCode = code;
  }

  /** O worker só pega quem ainda espera referência e cujo horário da próxima tentativa venceu. */
  isReferenceDue(now: Date): boolean {
    if (this._status !== 'PENDING_REFERENCE' || !this._nextReferenceAttemptAt) {
      return false;
    }

    return this._nextReferenceAttemptAt.getTime() <= now.getTime();
  }

  /** Esgotada a janela de espera, a transação vira rejeição em vez de esperar para sempre. */
  hasExhaustedReferenceRetries(): boolean {
    return this._referenceAttempts >= MAX_REFERENCE_ATTEMPTS;
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.includes(this._status);
  }

  affectsBalance(): boolean {
    return this.kind !== 'LOSS';
  }

  requiresReference(): boolean {
    return KINDS_REQUIRING_REFERENCE.includes(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /** BET debita, OPENING/WIN/REFUND creditam e ROLLBACK faz o contrário da referência. */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (!this.affectsBalance()) {
      throw new DomainError(
        'INVALID_TRANSACTION_STATE',
        `${this.kind} não gera lançamento no ledger`,
        {
          transactionId: this.id,
          kind: this.kind,
        },
      );
    }

    if (this.kind !== 'ROLLBACK') {
      return CREDIT_KINDS.includes(this.kind) ? 'CREDIT' : 'DEBIT';
    }

    if (!reference) {
      throw new DomainError(
        'INVALID_TRANSACTION_STATE',
        'ROLLBACK precisa da referência para definir a direção',
        { transactionId: this.id },
      );
    }

    if (!reference.affectsBalance()) {
      throw new DomainError(
        'INVALID_TRANSACTION_STATE',
        `ROLLBACK não pode reverter ${reference.kind}, que não gera lançamento`,
        { transactionId: this.id, referenceKind: reference.kind },
      );
    }

    return CREDIT_KINDS.includes(reference.kind) ? 'DEBIT' : 'CREDIT';
  }

  private assertNotTerminal(target: WagerTransactionStatus): void {
    if (this.isTerminal()) {
      throw new DomainError(
        'INVALID_TRANSACTION_STATE',
        `Transição inválida de ${this._status} para ${target}`,
        { transactionId: this.id, from: this._status, to: target },
      );
    }
  }
}
