import { Module } from '@nestjs/common';
import { LoggingModule } from './infrastructure/observability/logging.module';
import { HealthController } from './interfaces/http/health.controller';

@Module({
  imports: [LoggingModule],
  controllers: [HealthController],
})
export class AppModule {}
