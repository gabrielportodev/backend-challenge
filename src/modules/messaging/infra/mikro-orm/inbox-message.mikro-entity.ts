import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

/** Dedup do consumidor: a chave composta é a própria garantia de processar uma vez só. */
@Entity({ tableName: 'inbox_messages' })
export class InboxMessageEntity {
  @PrimaryKey({ columnType: 'varchar(64)' })
  consumerName!: string;

  @PrimaryKey({ columnType: 'varchar(255)' })
  messageId!: string;

  @Property({ columnType: 'char(64)' })
  payloadHash!: string;

  @Property({ columnType: 'timestamptz' })
  receivedAt!: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  processedAt?: Date;
}
