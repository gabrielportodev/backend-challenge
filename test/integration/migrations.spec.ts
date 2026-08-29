import { afterAll, describe, expect, it } from 'bun:test';
import ormConfig from '@config/orm.config';
import { MikroORM } from '@mikro-orm/postgresql';
import { assertTestDatabase } from '@test/support/database';

const TABELAS = [
  'wallets',
  'wager_transactions',
  'wallet_ledger_entries',
  'inbox_messages',
  'outbox_messages',
];

async function tabelasExistentes(orm: MikroORM): Promise<string[]> {
  const rows = await orm.em
    .getConnection()
    .execute<{ table_name: string }[]>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );

  return rows
    .map((row) => row.table_name)
    .filter((name) => TABELAS.includes(name))
    .sort();
}

/**
 * Migration que não volta não é reversível de verdade. Este teste desfaz o schema inteiro e
 * refaz, então tem que rodar sozinho — por isso abre a própria conexão, sem a aplicação.
 */
describe('migrations', () => {
  assertTestDatabase();

  let orm: MikroORM;

  afterAll(async () => {
    await orm?.close(true);
  });

  it('aplica, reverte e aplica de novo o schema inteiro', async () => {
    orm = await MikroORM.init(ormConfig);

    const migrator = orm.getMigrator();

    await migrator.up();

    expect(await tabelasExistentes(orm)).toEqual([...TABELAS].sort());
    expect(await migrator.getPendingMigrations()).toBeEmpty();

    await migrator.down({ to: 0 });

    expect(await tabelasExistentes(orm)).toBeEmpty();
    expect(await migrator.getExecutedMigrations()).toBeEmpty();

    await migrator.up();

    expect(await tabelasExistentes(orm)).toEqual([...TABELAS].sort());
    expect(await migrator.getExecutedMigrations()).toHaveLength(2);
  });

  it('recria o gatilho de append-only do ledger na volta', async () => {
    const [trigger] = await orm.em.getConnection().execute<{ tgname: string }[]>(
      `select tgname from pg_trigger
        where tgrelid = 'wallet_ledger_entries'::regclass and not tgisinternal
        order by tgname`,
    );

    expect(trigger?.tgname).toBe('wallet_ledger_entries_no_change');
  });
});
