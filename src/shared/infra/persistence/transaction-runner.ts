import { EntityManager, IsolationLevel } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { TransactionRunner } from '@shared/kernel/transaction-runner.port';
import { isRetryableDatabaseError } from './database-error';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 20;

/** Espera crescente com jitter: sem o jitter as tentativas concorrentes voltam a colidir juntas. */
function retryDelay(attempt: number): number {
  const base = BASE_DELAY_MS * 2 ** (attempt - 1);

  return base + Math.random() * base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class MikroTransactionRunner implements TransactionRunner {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  /**
   * READ COMMITTED porque a linha da wallet já é travada com FOR UPDATE; isolamento maior
   * só geraria mais abortos. O `em.transactional` publica a transação no contexto, então os
   * repositórios enxergam a mesma conexão sem receberem nada por parâmetro.
   */
  async run<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.em.transactional(() => work(), {
          isolationLevel: IsolationLevel.READ_COMMITTED,
        });
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isRetryableDatabaseError(error)) {
          throw error;
        }

        await sleep(retryDelay(attempt));
      }
    }
  }
}
