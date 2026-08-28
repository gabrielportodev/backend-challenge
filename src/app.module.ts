import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApplicationModule } from './application/application.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { LoggingModule } from './infrastructure/observability/logging.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { DomainExceptionFilter } from './interfaces/http/domain-exception.filter';
import { HealthController } from './interfaces/http/health.controller';

@Module({
  imports: [LoggingModule, PersistenceModule, MessagingModule, ApplicationModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
