import { Migration } from '@mikro-orm/migrations';

/**
 * Estado de retry da transação que chegou antes da referência. Sem essas colunas o worker não
 * teria como aplicar backoff nem saber quando desistir — releria todas as pendentes toda vez.
 */
export class Migration20260828200000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "wager_transactions"
        add column "reference_attempts" int not null default 0,
        add column "next_reference_attempt_at" timestamptz null;
    `);

    // Só as que ainda esperam referência entram no índice: a fila do worker é pequena.
    this.addSql(`
      create index "wager_transactions_pending_reference_idx"
        on "wager_transactions" ("next_reference_attempt_at")
        where "status" = 'PENDING_REFERENCE';
    `);

    // Substituído pelo índice parcial acima, que é o único caminho de busca do worker.
    this.addSql(`drop index if exists "wager_transactions_status_created_at_index";`);
  }

  override async down(): Promise<void> {
    this.addSql(`
      create index "wager_transactions_status_created_at_index"
        on "wager_transactions" ("status", "created_at");
    `);

    this.addSql(`drop index if exists "wager_transactions_pending_reference_idx";`);

    this.addSql(`
      alter table "wager_transactions"
        drop column if exists "next_reference_attempt_at",
        drop column if exists "reference_attempts";
    `);
  }
}
