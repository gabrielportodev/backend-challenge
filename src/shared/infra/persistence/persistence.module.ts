import ormConfig from '@config/orm.config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { TRANSACTION_RUNNER } from '@shared/kernel/transaction-runner.port';
import { MikroTransactionRunner } from './transaction-runner';

/**
 * Conexão e transação são de todo mundo, então ficam aqui. Cada módulo registra os próprios
 * repositórios: o que atravessa a aplicação é o `EntityManager`, não a implementação de porta.
 */
@Module({
  imports: [MikroOrmModule.forRoot(ormConfig)],
  providers: [{ provide: TRANSACTION_RUNNER, useClass: MikroTransactionRunner }],
  exports: [MikroOrmModule, TRANSACTION_RUNNER],
})
export class PersistenceModule {}
