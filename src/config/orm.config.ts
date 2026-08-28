import { ReflectMetadataProvider } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';
import { env } from './env';
import { entities } from './orm-entities';

/** Config única: serve o CLI de migrations e o módulo do Nest. */
export default defineConfig({
  clientUrl: env.DATABASE_URL,
  entities,
  // Sem ts-morph: o tipo de cada coluna já está declarado nas entidades.
  metadataProvider: ReflectMetadataProvider,
  extensions: [Migrator],
  // Grava e lê em UTC, para o horário não depender do fuso da máquina.
  forceUtcTimezone: true,
  migrations: {
    path: './src/migrations',
    tableName: 'mikro_orm_migrations',
    transactional: true,
    // Migrations escritas à mão: trigger e índice parcial não saem do diff automático.
    snapshot: false,
    emit: 'ts',
  },
  debug: env.NODE_ENV === 'development',
});
