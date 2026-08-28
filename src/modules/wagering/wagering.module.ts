import { MessagingModule } from '@modules/messaging/messaging.module';
import { WalletPersistenceModule } from '@modules/wallet/infra/mikro-orm/wallet-persistence.module';
import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { GetTransactionUseCase } from './application/use-cases/get-transaction.use-case';
import { SubmitWagerTransactionUseCase } from './application/use-cases/submit-wager-transaction.use-case';
import { WageringController } from './infra/http/wagering.controller';
import { WageringPersistenceModule } from './infra/mikro-orm/wagering-persistence.module';

const useCases = [SubmitWagerTransactionUseCase, GetTransactionUseCase];

// O mesmo use case atende o HTTP e a fila; o consumidor SQS entra por aqui quando existir.
@Module({
  imports: [PersistenceModule, WageringPersistenceModule, WalletPersistenceModule, MessagingModule],
  controllers: [WageringController],
  providers: useCases,
  exports: useCases,
})
export class WageringModule {}
