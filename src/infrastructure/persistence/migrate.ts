import { MikroORM } from '@mikro-orm/postgresql';
import config from './orm.config';

/**
 * Roda as migrations sem passar pelo CLI do MikroORM, que espera ts-node e não o Bun.
 * Uso: bun src/infrastructure/persistence/migrate.ts [up|down|list]
 */
async function main(): Promise<void> {
  const comando = process.argv[2] ?? 'up';
  const orm = await MikroORM.init(config);
  const migrator = orm.getMigrator();

  try {
    switch (comando) {
      case 'up': {
        const aplicadas = await migrator.up();
        console.log(
          `migrations aplicadas: ${aplicadas.map((m) => m.name).join(', ') || 'nenhuma'}`,
        );
        break;
      }
      case 'down': {
        const revertidas = await migrator.down();
        console.log(`migrations revertidas: ${revertidas.map((m) => m.name).join(', ')}`);
        break;
      }
      case 'list': {
        const executadas = await migrator.getExecutedMigrations();
        const pendentes = await migrator.getPendingMigrations();
        console.log(`aplicadas: ${executadas.map((m) => m.name).join(', ') || 'nenhuma'}`);
        console.log(`pendentes: ${pendentes.map((m) => m.name).join(', ') || 'nenhuma'}`);
        break;
      }
      default:
        throw new Error(`Comando desconhecido: ${comando}. Use up, down ou list.`);
    }
  } finally {
    await orm.close(true);
  }
}

// O código de saída importa: é ele que diz ao Compose se o passo de migration deu certo.
main().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
