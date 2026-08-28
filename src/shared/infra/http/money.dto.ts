import { z } from 'zod';

// String decimal e nunca number: o JSON.parse de um number já teria passado por float.
export const moneySchema = z.object({
  amount: z
    .string()
    .regex(/^\d{1,17}(\.\d{1,2})?$/, 'valor deve ser string decimal não negativa com até 2 casas'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'moeda deve ser o código ISO de 3 letras maiúsculas'),
});
