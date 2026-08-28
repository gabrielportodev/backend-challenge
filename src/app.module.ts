import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApplicationModule } from './application/application.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { LoggingModule } from './infrastructure/observability/logging.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { HttpModule } from './interfaces/http/http.module';
import { DomainExceptionFilter } from './interfaces/http/support/domain-exception.filter';

@Module({
  imports: [LoggingModule, PersistenceModule, MessagingModule, ApplicationModule, HttpModule],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
