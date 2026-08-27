import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

// Lê e valida as variáveis de ambiente uma única vez, quando o processo sobe.
export const env: Env = envSchema.parse(process.env);
