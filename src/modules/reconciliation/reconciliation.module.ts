import { WalletPersistenceModule } from '@modules/wallet/infra/mikro-orm/wallet-persistence.module';
import { Module } from '@nestjs/common';
import { MetricsModule } from '@shared/infra/metrics/metrics.module';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { ReconcileWalletUseCase } from './application/use-cases/reconcile-wallet.use-case';
import { ReconciliationController } from './infra/http/reconciliation.controller';

// Só lê: compara o saldo gravado com o que o ledger reconstrói, sem tocar em nenhum dos dois.
@Module({
  imports: [PersistenceModule, MetricsModule, WalletPersistenceModule],
  controllers: [ReconciliationController],
  providers: [ReconcileWalletUseCase],
  exports: [ReconcileWalletUseCase],
})
export class ReconciliationModule {}
