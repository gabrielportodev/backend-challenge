import { z } from 'zod';
import { idempotencyKeySchema, submitTransactionSchema } from '../http/wagering.dto';

/**
 * O envelope que o provedor publica na fila. As regras de `data` são as mesmas do corpo HTTP, de
 * propósito: as duas entradas chamam o mesmo use case, então não podem aceitar coisas diferentes.
 *
 * `messageId` é a identidade da mensagem para o inbox. Não é o id que a fila gera: aquele muda a
 * cada republicação do produtor, e é justamente a republicação que precisa ser reconhecida.
 */
export const wagerMessageSchema = z.object({
  messageId: z.string().min(1).max(255),
  type: z.literal('WagerTransactionRequested'),
  occurredAt: z.iso.datetime(),
  // Opcional: liga o log e o evento ao rastro que o provedor já tinha, como o header faz no HTTP.
  correlationId: z.string().min(1).max(255).optional(),
  // A chave de idempotência viaja dentro do corpo porque a fila não tem header onde colocá-la.
  data: submitTransactionSchema.extend({ idempotencyKey: idempotencyKeySchema }),
});

export type WagerMessage = z.infer<typeof wagerMessageSchema>;
