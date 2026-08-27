import { Module } from '@nestjs/common';
import { IdentityModule } from './infrastructure/identity/identity.module';
import { MessagingModule } from './infrastructure/messaging/messaging.module';
import { LoggingModule } from './infrastructure/observability/logging.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { HealthController } from './interfaces/http/health.controller';

@Module({
  imports: [LoggingModule, PersistenceModule, MessagingModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
