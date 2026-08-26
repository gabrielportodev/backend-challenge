import { Module } from '@nestjs/common';
import { ConfigModule } from './infrastructure/config/env';
import { LoggingModule } from './infrastructure/observability/logging.module';
import { HealthController } from './interfaces/http/health.controller';

@Module({
  imports: [ConfigModule, LoggingModule],
  controllers: [HealthController],
})
export class AppModule {}
