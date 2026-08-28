import { MessagingModule } from '@modules/messaging/messaging.module';
import { WalletPersistenceModule } from '@modules/wallet/infra/mikro-orm/wallet-persistence.module';
import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { PendingReferenceWorker } from './application/pending-reference.worker';
import { GetTransactionUseCase } from './application/use-cases/get-transaction.use-case';
import { SubmitWagerTransactionUseCase } from './application/use-cases/submit-wager-transaction.use-case';
import { WagerSettlement } from './application/wager-settlement';
import { WageringController } from './infra/http/wagering.controller';
import { WageringPersistenceModule } from './infra/mikro-orm/wagering-persistence.module';
import { WagerTransactionsConsumer } from './infra/sqs/wager-transactions.consumer';

const useCases = [SubmitWagerTransactionUseCase, GetTransactionUseCase];

// O mesmo use case atende as duas entradas: o controller HTTP e o consumidor da fila.
@Module({
  imports: [PersistenceModule, WageringPersistenceModule, WalletPersistenceModule, MessagingModule],
  controllers: [WageringController],
  providers: [...useCases, WagerSettlement, PendingReferenceWorker, WagerTransactionsConsumer],
  exports: useCases,
})
export class WageringModule {}
