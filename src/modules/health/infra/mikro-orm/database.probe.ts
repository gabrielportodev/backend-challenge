import { EntityManager } from '@mikro-orm/postgresql';
import type { HealthProbe } from '@modules/health/domain/health-probe.port';
import { Inject, Injectable } from '@nestjs/common';

/**
 * A consulta é trivial porque o que precisa ser verificado é se a conexão responde, e não o
 * schema. Checar apenas o pool não prova que o banco está acessível.
 */
@Injectable()
export class DatabaseProbe implements HealthProbe {
  readonly name = 'database';

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async check(): Promise<void> {
    await this.em.getConnection().execute('select 1');
  }
}
