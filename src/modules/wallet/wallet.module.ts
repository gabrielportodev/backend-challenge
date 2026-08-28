import { MessagingModule } from '@modules/messaging/messaging.module';
import { WageringPersistenceModule } from '@modules/wagering/infra/mikro-orm/wagering-persistence.module';
import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { CreateWalletUseCase } from './application/use-cases/create-wallet.use-case';
import { GetLedgerUseCase } from './application/use-cases/get-ledger.use-case';
import { GetWalletUseCase } from './application/use-cases/get-wallet.use-case';
import { WalletController } from './infra/http/wallet.controller';
import { WalletPersistenceModule } from './infra/mikro-orm/wallet-persistence.module';

const useCases = [CreateWalletUseCase, GetWalletUseCase, GetLedgerUseCase];

/**
 * Abrir wallet grava uma transação OPENING e um evento junto com o saldo inicial, tudo na mesma
 * transação SQL. Daí a dependência do repositório de wagering e do outbox.
 */
@Module({
  imports: [PersistenceModule, WalletPersistenceModule, WageringPersistenceModule, MessagingModule],
  controllers: [WalletController],
  providers: useCases,
  exports: useCases,
})
export class WalletModule {}
