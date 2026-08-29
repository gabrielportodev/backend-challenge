import { EntityManager } from '@mikro-orm/postgresql';
import type { HealthProbe } from '@modules/health/domain/health-probe.port';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Consulta trivial de propósito: o que precisa ser provado é que a conexão responde, não o
 * schema. Um pool que só existe, sem viagem até o banco, não diz nada.
 */
@Injectable()
export class DatabaseProbe implements HealthProbe {
  readonly name = 'database';

  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async check(): Promise<void> {
    await this.em.getConnection().execute('select 1');
  }
}
