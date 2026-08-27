export const MESSAGE_PUBLISHER = 'MessagePublisher';

export interface OutgoingMessage {
  /** O eventId. Vira chave de deduplicação na fila, então republicar não gera mensagem nova. */
  id: string;
  /** O walletId. Agrupa as mensagens da mesma wallet para a fila preservar a ordem entre elas. */
  groupId: string;
  /** O envelope do evento já serializado. */
  body: string;
}

export interface MessagePublisherPort {
  publish(message: OutgoingMessage): Promise<void>;
}
