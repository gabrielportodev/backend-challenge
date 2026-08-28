import { Migration } from '@mikro-orm/migrations';

/**
 * Schema inicial. As garantias do desafio estão aqui, no banco, e não só no código:
 * saldo não negativo, uma aposta por chave de idempotência, um lançamento por wallet
 * por transação, aritmética do ledger fechando e ledger imutável.
 */
export class Migration20260826120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "wallets" (
        "id" uuid not null,
        "player_id" varchar(64) not null,
        "currency" char(3) not null,
        "balance_amount" numeric(19,2) not null,
        "version" int not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "wallets_pkey" primary key ("id")
      );
    `);

    // Uma wallet por jogador e moeda. Criar duas em paralelo colide aqui.
    this.addSql(`
      alter table "wallets"
        add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");
    `);

    // Última barreira contra saldo negativo, mesmo que alguma checagem escape do código.
    this.addSql(`
      alter table "wallets"
        add constraint "wallets_balance_non_negative" check ("balance_amount" >= 0);
    `);

    this.addSql(`
      create table "wager_transactions" (
        "id" uuid not null,
        "provider_id" varchar(64) not null,
        "external_transaction_id" varchar(128) not null,
        "idempotency_key" varchar(255) not null,
        "payload_hash" char(64) not null,
        "wallet_id" uuid not null,
        "player_id" varchar(64) not null,
        "round_id" varchar(128) not null,
        "game_id" varchar(128) not null,
        "kind" text not null,
        "amount" numeric(19,2) not null,
        "currency" char(3) not null,
        "reference_external_transaction_id" varchar(128) null,
        "reference_transaction_id" uuid null,
        "status" text not null,
        "failure_code" varchar(48) null,
        "created_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "wager_transactions_pkey" primary key ("id")
      );
    `);

    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_kind_check"
        check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));
    `);

    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_status_check"
        check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));
    `);

    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_amount_positive" check ("amount" > 0);
    `);

    // A idempotência mora no banco: a segunda tentativa da mesma chave não entra.
    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_provider_id_idempotency_key_unique"
        unique ("provider_id", "idempotency_key");
    `);

    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_provider_id_external_transaction_id_unique"
        unique ("provider_id", "external_transaction_id");
    `);

    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_wallet_fk"
        foreign key ("wallet_id") references "wallets" ("id");
    `);

    this.addSql(`
      alter table "wager_transactions"
        add constraint "wager_transactions_reference_fk"
        foreign key ("reference_transaction_id") references "wager_transactions" ("id");
    `);

    // Usado pelo worker que reprocessa quem ficou em PENDING_REFERENCE.
    this.addSql(`
      create index "wager_transactions_status_created_at_index"
        on "wager_transactions" ("status", "created_at");
    `);

    // Uma reversão de cada tipo por referência: bloqueia REFUND ou ROLLBACK em dobro.
    this.addSql(`
      create unique index "wager_transactions_single_reversal_idx"
        on "wager_transactions" ("reference_transaction_id", "kind")
        where "status" = 'PROCESSED' and "reference_transaction_id" is not null;
    `);

    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" uuid not null,
        "wallet_id" uuid not null,
        "transaction_id" uuid not null,
        "direction" text not null,
        "currency" char(3) not null,
        "amount" numeric(19,2) not null,
        "balance_before_amount" numeric(19,2) not null,
        "balance_after_amount" numeric(19,2) not null,
        "created_at" timestamptz not null,
        constraint "wallet_ledger_entries_pkey" primary key ("id")
      );
    `);

    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_direction_check"
        check ("direction" in ('DEBIT', 'CREDIT'));
    `);

    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_amount_positive" check ("amount" > 0);
    `);

    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_balance_non_negative"
        check ("balance_before_amount" >= 0 and "balance_after_amount" >= 0);
    `);

    // Mesma conta do isBalanced do domínio, agora como constraint.
    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_balanced" check (
          "balance_after_amount" = case
            when "direction" = 'DEBIT' then "balance_before_amount" - "amount"
            else "balance_before_amount" + "amount"
          end
        );
    `);

    // No máximo um lançamento por wallet por transação: é o que impede o débito em dobro.
    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_wallet_id_transaction_id_unique"
        unique ("wallet_id", "transaction_id");
    `);

    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_wallet_fk"
        foreign key ("wallet_id") references "wallets" ("id");
    `);

    this.addSql(`
      alter table "wallet_ledger_entries"
        add constraint "wallet_ledger_entries_transaction_fk"
        foreign key ("transaction_id") references "wager_transactions" ("id");
    `);

    // Índice do extrato paginado; o id entra para o cursor não empatar em createdAt igual.
    this.addSql(`
      create index "wallet_ledger_entries_wallet_id_created_at_id_index"
        on "wallet_ledger_entries" ("wallet_id", "created_at", "id");
    `);

    // Imutabilidade no schema: o ledger só aceita INSERT.
    this.addSql(`
      create function "wallet_ledger_entries_append_only"() returns trigger as $$
      begin
        raise exception 'wallet_ledger_entries e append-only: % nao e permitido', tg_op;
      end;
      $$ language plpgsql;
    `);

    this.addSql(`
      create trigger "wallet_ledger_entries_no_change"
        before update or delete on "wallet_ledger_entries"
        for each row execute function "wallet_ledger_entries_append_only"();
    `);

    this.addSql(`
      create trigger "wallet_ledger_entries_no_truncate"
        before truncate on "wallet_ledger_entries"
        for each statement execute function "wallet_ledger_entries_append_only"();
    `);

    // Dedup do consumidor SQS: a chave composta é a garantia de processar uma vez só.
    this.addSql(`
      create table "inbox_messages" (
        "consumer_name" varchar(64) not null,
        "message_id" varchar(255) not null,
        "payload_hash" char(64) not null,
        "received_at" timestamptz not null,
        "processed_at" timestamptz null,
        constraint "inbox_messages_pkey" primary key ("consumer_name", "message_id")
      );
    `);

    this.addSql(`
      create table "outbox_messages" (
        "id" uuid not null,
        "aggregate_id" uuid not null,
        "event_type" varchar(64) not null,
        "payload" jsonb not null,
        "occurred_at" timestamptz not null,
        "attempts" int not null default 0,
        "next_attempt_at" timestamptz null,
        "published_at" timestamptz null,
        constraint "outbox_messages_pkey" primary key ("id")
      );
    `);

    // Índice parcial: o worker publicador só enxerga o que ainda não foi publicado.
    this.addSql(`
      create index "outbox_messages_pending_idx"
        on "outbox_messages" ("next_attempt_at", "occurred_at")
        where "published_at" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
    this.addSql(`drop function if exists "wallet_ledger_entries_append_only"() cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
  }
}
