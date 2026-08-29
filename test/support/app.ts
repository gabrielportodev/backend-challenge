import type { AddressInfo } from 'node:net';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EntityManager as EntityManagerToken } from '@mikro-orm/postgresql';
import { OutboxPublisherWorker } from '@modules/messaging/application/outbox-publisher.worker';
import { PendingReferenceWorker } from '@modules/wagering/application/pending-reference.worker';
import { WagerTransactionsConsumer } from '@modules/wagering/infra/sqs/wager-transactions.consumer';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { migrateTestDatabase, truncateAll } from './database';

/** Os laços de fundo, que ficam parados por padrão para o teste não correr contra eles. */
const WORKERS = [OutboxPublisherWorker, PendingReferenceWorker, WagerTransactionsConsumer];

/** Consulta direta ao banco, para as asserções olharem as linhas e não o cache do ORM. */
export type Sql = <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;

export interface TestApp {
  app: INestApplication;
  /** Endereço do servidor HTTP real, em porta efêmera. */
  url: string;
  em: EntityManager;
  sql: Sql;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface ProviderOverride {
  token: unknown;
  value: unknown;
}

export interface TestAppOptions {
  /**
   * Liga consumidor e workers de verdade. Só faz sentido no teste ponta a ponta pela fila;
   * nos demais o worker é instanciado à mão, para a varredura acontecer quando o teste quer.
   */
  workers?: boolean;
  /** Troca providers por dublês — usado para forçar falha no meio da transação financeira. */
  overrides?: ProviderOverride[];
}

/** Sobe a aplicação inteira contra o Postgres e o LocalStack dos containers de teste. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  await migrateTestDatabase();

  const builder = Test.createTestingModule({ imports: [AppModule] });

  if (!options.workers) {
    for (const worker of WORKERS) {
      builder.overrideProvider(worker).useValue({});
    }
  }

  for (const override of options.overrides ?? []) {
    builder.overrideProvider(override.token).useValue(override.value);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  await app.listen(0, '127.0.0.1');

  const { port } = app.getHttpServer().address() as AddressInfo;
  const em = app.get(EntityManagerToken);

  const sql: Sql = async <T>(query: string, params: unknown[] = []) =>
    em.getConnection().execute<T[]>(query, params);

  return {
    app,
    url: `http://127.0.0.1:${port}`,
    em,
    sql,
    reset: () => truncateAll(em),
    close: () => app.close(),
  };
}
