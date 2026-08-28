import { Module } from '@nestjs/common';
import { PersistenceModule } from '@shared/infra/persistence/persistence.module';
import { LEDGER_REPOSITORY } from '../../domain/ledger.repository.port';
import { WALLET_REPOSITORY } from '../../domain/wallet.repository.port';
import { MikroLedgerRepository } from './ledger.repository';
import { MikroWalletRepository } from './wallet.repository';

const providers = [
  { provide: WALLET_REPOSITORY, useClass: MikroWalletRepository },
  { provide: LEDGER_REPOSITORY, useClass: MikroLedgerRepository },
];

/**
 * Só as ligações porta/adaptador do contexto, sem use case nenhum. É o que permite wallet e
 * wagering dependerem dos repositórios um do outro sem os módulos de feature ficarem cíclicos.
 */
@Module({
  imports: [PersistenceModule],
  providers,
  exports: providers.map((provider) => provider.provide),
})
export class WalletPersistenceModule {}
