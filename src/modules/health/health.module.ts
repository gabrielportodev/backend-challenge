import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { CheckReadinessUseCase } from './application/check-readiness.use-case';
import { HEALTH_PROBES } from './domain/health-probe.port';
import { HealthController } from './infra/http/health.controller';
import { DatabaseProbe } from './infra/mikro-orm/database.probe';
import { QueueProbe } from './infra/sqs/queue.probe';

@Module({
  imports: [PersistenceModule],
  controllers: [HealthController],
  providers: [
    DatabaseProbe,
    QueueProbe,
    {
      provide: HEALTH_PROBES,
      useFactory: (database: DatabaseProbe, queue: QueueProbe) => [database, queue],
      inject: [DatabaseProbe, QueueProbe],
    },
    CheckReadinessUseCase,
  ],
})
export class HealthModule { }
