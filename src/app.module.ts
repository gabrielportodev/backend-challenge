import { HealthModule } from '@modules/health/health.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { ReconciliationModule } from '@modules/reconciliation/reconciliation.module';
import { WageringModule } from '@modules/wagering/wagering.module';
import { WalletModule } from '@modules/wallet/wallet.module';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainExceptionFilter } from '@shared/infra/http/domain-exception.filter';
import { LoggingModule } from '@shared/infra/logger/logging.module';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';

@Module({
  imports: [
    LoggingModule,
    PersistenceModule,
    MessagingModule,
    WalletModule,
    WageringModule,
    ReconciliationModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
