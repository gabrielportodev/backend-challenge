import {
  INBOX_REPOSITORY,
  LEDGER_REPOSITORY,
  OUTBOX_REPOSITORY,
  TRANSACTION_RUNNER,
  WAGER_TRANSACTION_REPOSITORY,
  WALLET_REPOSITORY,
} from '@application/ports';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { entities } from './entities';
import ormConfig from './orm.config';
import {
  MikroInboxRepository,
  MikroLedgerRepository,
  MikroOutboxRepository,
  MikroTransactionRunner,
  MikroWagerTransactionRepository,
  MikroWalletRepository,
} from './repositories';

// A aplicação depende só dos tokens; qual ORM está atrás deles não sai desta pasta.
const providers = [
  { provide: TRANSACTION_RUNNER, useClass: MikroTransactionRunner },
  { provide: WALLET_REPOSITORY, useClass: MikroWalletRepository },
  { provide: WAGER_TRANSACTION_REPOSITORY, useClass: MikroWagerTransactionRepository },
  { provide: LEDGER_REPOSITORY, useClass: MikroLedgerRepository },
  { provide: INBOX_REPOSITORY, useClass: MikroInboxRepository },
  { provide: OUTBOX_REPOSITORY, useClass: MikroOutboxRepository },
];

@Module({
  imports: [MikroOrmModule.forRoot(ormConfig), MikroOrmModule.forFeature(entities)],
  providers,
  exports: [MikroOrmModule, ...providers.map((provider) => provider.provide)],
})
export class PersistenceModule {}
