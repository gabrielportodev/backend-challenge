import { Check, Entity, Enum, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@modules/wagering/domain/wager-transaction.aggregate';
import type { FailureCode } from '@shared/domain/errors';

const KINDS: WagerTransactionKind[] = ['OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'];

const STATUSES: WagerTransactionStatus[] = [
  'PENDING',
  'PENDING_REFERENCE',
  'PROCESSED',
  'REJECTED',
  'FAILED',
];

@Entity({ tableName: 'wager_transactions' })
// A chave de idempotência é única por provedor: é ela que barra o débito duplicado.
@Unique({
  name: 'wager_transactions_provider_id_idempotency_key_unique',
  properties: ['providerId', 'idempotencyKey'],
})
@Unique({
  name: 'wager_transactions_provider_id_external_transaction_id_unique',
  properties: ['providerId', 'externalTransactionId'],
})
@Check({ name: 'wager_transactions_amount_positive', expression: 'amount > 0' })
// Índice usado pelo worker que reprocessa quem está esperando referência.
@Index({
  name: 'wager_transactions_status_created_at_index',
  properties: ['status', 'createdAt'],
})
// Uma reversão de cada tipo por referência: bloqueia REFUND ou ROLLBACK em dobro.
@Index({
  name: 'wager_transactions_single_reversal_idx',
  expression: `create unique index "wager_transactions_single_reversal_idx"
    on "wager_transactions" ("reference_transaction_id", "kind")
    where "status" = 'PROCESSED' and "reference_transaction_id" is not null`,
})
export class WagerTransactionEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id!: string;

  @Property({ columnType: 'varchar(64)' })
  providerId!: string;

  @Property({ columnType: 'varchar(128)' })
  externalTransactionId!: string;

  @Property({ columnType: 'varchar(255)' })
  idempotencyKey!: string;

  // SHA-256 em hexadecimal do JSON canônico dos campos de negócio.
  @Property({ columnType: 'char(64)' })
  payloadHash!: string;

  @Property({ columnType: 'uuid' })
  walletId!: string;

  @Property({ columnType: 'varchar(64)' })
  playerId!: string;

  @Property({ columnType: 'varchar(128)' })
  roundId!: string;

  @Property({ columnType: 'varchar(128)' })
  gameId!: string;

  @Enum({ items: () => KINDS })
  kind!: WagerTransactionKind;

  @Property({ columnType: 'numeric(19,2)' })
  amount!: string;

  @Property({ columnType: 'char(3)' })
  currency!: string;

  // Chega no payload; vira referenceTransactionId quando a referência é encontrada.
  @Property({ columnType: 'varchar(128)', nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ columnType: 'uuid', nullable: true })
  referenceTransactionId?: string;

  @Enum({ items: () => STATUSES })
  status!: WagerTransactionStatus;

  @Property({ columnType: 'varchar(48)', nullable: true })
  failureCode?: FailureCode;

  @Property({ columnType: 'timestamptz' })
  createdAt!: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  processedAt?: Date;
}
