import { env } from '@config/env';
import ormConfig from '@config/orm.config';
import type { EntityManager } from '@mikro-orm/postgresql';
import { MikroORM } from '@mikro-orm/postgresql';

const TEST_DATABASE = 'wagering_test';

/**
 * Trava de segurança: a limpeza abaixo apaga tudo, e apontar sem querer para o banco de
 * desenvolvimento sairia caro. Só o `.env.test` leva ao banco descartável.
 */
export function assertTestDatabase(): void {
  if (!env.DATABASE_URL.endsWith(TEST_DATABASE)) {
    throw new Error(
      `DATABASE_URL aponta para ${env.DATABASE_URL}, e não para ${TEST_DATABASE}. ` +
        'Rode pelos scripts test:integration / test:concurrency, que carregam o .env.test.',
    );
  }
}

let migrated = false;

/** Aplica as migrations pendentes uma vez por processo, antes do primeiro teste subir a app. */
export async function migrateTestDatabase(): Promise<void> {
  if (migrated) {
    return;
  }

  assertTestDatabase();

  const orm = await MikroORM.init(ormConfig);

  try {
    await orm.getMigrator().up();
    migrated = true;
  } finally {
    await orm.close(true);
  }
}

/**
 * Zera as tabelas entre os testes. O ledger precisa que o gatilho de append-only seja desligado
 * explicitamente — o que também é uma prova de que ele existe: sem isso, nem o teste apaga.
 */
export async function truncateAll(em: EntityManager): Promise<void> {
  assertTestDatabase();

  const connection = em.getConnection();

  await connection.execute('alter table wallet_ledger_entries disable trigger user');
  await connection.execute('delete from wallet_ledger_entries');
  await connection.execute('alter table wallet_ledger_entries enable trigger user');
  await connection.execute('delete from wager_transactions');
  await connection.execute('delete from wallets');
  await connection.execute('delete from inbox_messages');
  await connection.execute('delete from outbox_messages');
}

/** O SQLSTATE que o Postgres devolveu, mesmo embrulhado pelas exceções do MikroORM. */
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { code, previous } = error as { code?: unknown; previous?: unknown };

  return typeof code === 'string' ? code : sqlStateOf(previous);
}
