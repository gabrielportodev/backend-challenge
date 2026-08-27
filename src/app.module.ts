import { Module } from '@nestjs/common';
import { LoggingModule } from './infrastructure/observability/logging.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { HealthController } from './interfaces/http/health.controller';

@Module({
  imports: [LoggingModule, PersistenceModule],
  controllers: [HealthController],
})
export class AppModule {}
