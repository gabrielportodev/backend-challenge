export const MESSAGE_CONSUMER = 'MessageConsumer';

/** Uma entrega da fila. A mesma mensagem pode chegar de novo — quem deduplica é o inbox. */
export interface IncomingMessage {
  /** Id que a fila gerou. Serve para log e nada mais: a identidade de negócio vem no corpo. */
  id: string;
  /** Identifica esta entrega, não a mensagem: é o que a fila exige para apagar ou devolver. */
  receiptHandle: string;
  /** Quantas vezes esta mensagem já foi entregue, contando a atual. */
  receiveCount: number;
  body: string;
}

export interface MessageConsumerPort {
  /** Lê um lote. Segura a chamada enquanto a fila está vazia, então lote vazio é normal. */
  receive(max: number): Promise<IncomingMessage[]>;

  /** Apaga a mensagem da fila. Só depois do commit. */
  ack(message: IncomingMessage): Promise<void>;

  /** Devolve a mensagem para a fila, visível de novo daqui a `delaySeconds`. */
  retryLater(message: IncomingMessage, delaySeconds: number): Promise<void>;

  /** Copia a mensagem para a fila de mortas; apagar da origem continua sendo do chamador. */
  deadLetter(message: IncomingMessage): Promise<void>;
}
