import { PersistenceModule } from '@infrastructure/persistence/persistence.module';
import { Module } from '@nestjs/common';
import { GetTransactionUseCase } from './wagering/get-transaction.use-case';
import { SubmitWagerTransactionUseCase } from './wagering/submit-wager-transaction.use-case';
import { CreateWalletUseCase } from './wallet/create-wallet.use-case';
import { GetLedgerUseCase } from './wallet/get-ledger.use-case';
import { GetWalletUseCase } from './wallet/get-wallet.use-case';
import { ReconcileWalletUseCase } from './wallet/reconcile-wallet.use-case';

const useCases = [
  CreateWalletUseCase,
  GetWalletUseCase,
  GetLedgerUseCase,
  ReconcileWalletUseCase,
  SubmitWagerTransactionUseCase,
  GetTransactionUseCase,
];

@Module({
  imports: [PersistenceModule],
  providers: useCases,
  exports: useCases,
})
export class ApplicationModule {}
