import { Check, Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

/**
 * Linha crua da tabela. Não tem regra de negócio nem relação com outras entidades:
 * quem monta o agregado é o mapper. Os nomes das constraints são os mesmos da migration.
 */
@Entity({ tableName: 'wallets' })
@Unique({ name: 'wallets_player_id_currency_unique', properties: ['playerId', 'currency'] })
@Check({ name: 'wallets_balance_non_negative', expression: 'balance_amount >= 0' })
export class WalletEntity {
  @PrimaryKey({ columnType: 'uuid' })
  id!: string;

  @Property({ columnType: 'varchar(64)' })
  playerId!: string;

  @Property({ columnType: 'char(3)' })
  currency!: string;

  // NUMERIC exato, lido e escrito como string: o valor nunca passa por float.
  @Property({ columnType: 'numeric(19,2)' })
  balanceAmount!: string;

  // Guarda secundária no WHERE do UPDATE. A corretude vem do lock pessimista.
  @Property({ columnType: 'int' })
  version!: number;

  @Property({ columnType: 'timestamptz' })
  createdAt!: Date;

  @Property({ columnType: 'timestamptz' })
  updatedAt!: Date;
}
