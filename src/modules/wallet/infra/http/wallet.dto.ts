import { moneySchema } from '@shared/infra/http/money.dto';
import { z } from 'zod';

export const createWalletSchema = z.object({
  playerId: z.string().min(1).max(64),
  initialBalance: moneySchema,
});

export const walletIdSchema = z.uuid('walletId deve ser um UUID');

// O limite fora da faixa é aparado pelo use case, então aqui só recusamos o que não é número.
export const ledgerQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type CreateWalletBody = z.infer<typeof createWalletSchema>;
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
