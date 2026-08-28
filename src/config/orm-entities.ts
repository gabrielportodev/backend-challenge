import { InboxMessageEntity } from '@modules/messaging/infra/mikro-orm/inbox-message.mikro-entity';
import { OutboxMessageEntity } from '@modules/messaging/infra/mikro-orm/outbox-message.mikro-entity';
import { WagerTransactionEntity } from '@modules/wagering/infra/mikro-orm/wager-transaction.mikro-entity';
import { WalletEntity } from '@modules/wallet/infra/mikro-orm/wallet.mikro-entity';
import { WalletLedgerEntryEntity } from '@modules/wallet/infra/mikro-orm/wallet-ledger-entry.mikro-entity';

/**
 * Único ponto que enxerga as entidades de todos os módulos. Fica em `config` de propósito: é
 * fiação, não regra — e o discovery por glob de pasta não é confiável rodando no Bun.
 */
export const entities = [
  WalletEntity,
  WagerTransactionEntity,
  WalletLedgerEntryEntity,
  InboxMessageEntity,
  OutboxMessageEntity,
];
