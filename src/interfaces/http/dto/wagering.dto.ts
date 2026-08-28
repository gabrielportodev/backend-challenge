import { z } from 'zod';
import { moneySchema } from './money.dto';

// OPENING fica de fora: é interno, criado junto com a wallet, e nunca aceito pela borda.
const SUBMITTABLE_KINDS = ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'] as const;

export const submitTransactionSchema = z.object({
  providerId: z.string().min(1).max(64),
  externalTransactionId: z.string().min(1).max(128),
  playerId: z.string().min(1).max(64),
  walletId: z.uuid(),
  roundId: z.string().min(1).max(128),
  gameId: z.string().min(1).max(128),
  kind: z.enum(SUBMITTABLE_KINDS),
  money: moneySchema,
  referenceExternalTransactionId: z.string().min(1).max(128).optional(),
});

// Obrigatório: é a fonte da verdade da idempotência, não o corpo da requisição.
export const idempotencyKeySchema = z.string('Idempotency-Key é obrigatório').min(1).max(255);

export const transactionIdSchema = z.uuid('transactionId deve ser um UUID');
export const providerIdSchema = z.string().min(1).max(64);
export const externalTransactionIdSchema = z.string().min(1).max(128);

export type SubmitTransactionBody = z.infer<typeof submitTransactionSchema>;
