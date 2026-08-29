import ormConfig from '@config/orm.config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { MetricsModule } from '@shared/infra/metrics/metrics.module';
import { TRANSACTION_RUNNER } from '@shared/kernel/transaction-runner.port';
import { MikroTransactionRunner } from './transaction-runner';

/**
 * Conexão e transação são de todo mundo, então ficam aqui. Cada módulo registra os próprios
 * repositórios: o que atravessa a aplicação é o `EntityManager`, não a implementação de porta.
 *
 * O `forRoot` do MikroORM registra um módulo global, então o `EntityManager` já chega em todo
 * lugar — reexportá-lo daqui quebraria o boot, porque o módulo importado não é o `MikroOrmModule`.
 */
@Module({
  imports: [MikroOrmModule.forRoot(ormConfig), MetricsModule],
  providers: [{ provide: TRANSACTION_RUNNER, useClass: MikroTransactionRunner }],
  exports: [TRANSACTION_RUNNER],
})
export class PersistenceModule {}
