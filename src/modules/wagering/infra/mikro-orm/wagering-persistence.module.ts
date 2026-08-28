import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { WAGER_TRANSACTION_REPOSITORY } from '../../domain/wager-transaction.repository.port';
import { MikroWagerTransactionRepository } from './wager-transaction.repository';

const providers = [
  { provide: WAGER_TRANSACTION_REPOSITORY, useClass: MikroWagerTransactionRepository },
];

// Ver WalletPersistenceModule: ligação de porta separada da feature para não haver ciclo.
@Module({
  imports: [PersistenceModule],
  providers,
  exports: providers.map((provider) => provider.provide),
})
export class WageringPersistenceModule {}
