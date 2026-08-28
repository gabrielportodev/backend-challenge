import type { OutboxMessage } from './outbox-message.entity';

export const OUTBOX_REPOSITORY = 'OutboxRepository';

export interface OutboxRepository {
  /** Entra na mesma transação do dado financeiro: evento nenhum é publicado antes do commit. */
  enqueue(message: OutboxMessage): Promise<void>;

  /**
   * Pendentes com o retry vencido, já travadas para este publisher. Precisa rodar dentro de
   * uma transação, porque é o lock que impede dois workers de pegarem a mesma linha.
   */
  findDue(limit: number, now: Date): Promise<OutboxMessage[]>;

  update(message: OutboxMessage): Promise<void>;
}
