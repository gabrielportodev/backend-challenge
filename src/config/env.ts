import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.url(),

  AWS_REGION: z.string().min(1).default('us-east-1'),
  // Aponta para o LocalStack em desenvolvimento; em produção fica vazio e vale o padrão da AWS.
  AWS_ENDPOINT_URL: z.url().optional(),
  // Fila de entrada, consumida pelo serviço.
  SQS_WAGER_QUEUE_URL: z.url(),
  // Fila de saída, onde o worker do outbox publica os eventos de integração.
  SQS_EVENTS_QUEUE_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

// Lê e valida as variáveis de ambiente uma única vez, quando o processo sobe.
export const env: Env = envSchema.parse(process.env);
