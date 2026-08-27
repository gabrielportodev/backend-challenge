import { InboxMessageEntity } from './inbox-message.entity';
import { OutboxMessageEntity } from './outbox-message.entity';
import { WagerTransactionEntity } from './wager-transaction.entity';
import { WalletEntity } from './wallet.entity';
import { WalletLedgerEntryEntity } from './wallet-ledger-entry.entity';

export { InboxMessageEntity } from './inbox-message.entity';
export { OutboxMessageEntity } from './outbox-message.entity';
export { WagerTransactionEntity } from './wager-transaction.entity';
export { WalletEntity } from './wallet.entity';
export { WalletLedgerEntryEntity } from './wallet-ledger-entry.entity';

/** Lista explícita em vez de glob: o discovery por pasta não é confiável rodando no Bun. */
export const entities = [
  WalletEntity,
  WagerTransactionEntity,
  WalletLedgerEntryEntity,
  InboxMessageEntity,
  OutboxMessageEntity,
];
