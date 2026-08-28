import { randomUUID } from 'node:crypto';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { idempotencyKeySchema } from '../dto/wagering.dto';
import { CORRELATION_ID_HEADER, type HttpResponse } from './http-response';
import { ZodValidationPipe } from './zod-validation.pipe';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const idempotencyKeyPipe = new ZodValidationPipe(idempotencyKeySchema);

/**
 * O correlationId já foi resolvido pelo logger HTTP — herdado do provedor ou gerado — e devolvido
 * no header da resposta. Aqui ele só é lido de volta para acompanhar a transação e o evento.
 */
export const CorrelationId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const response = context.switchToHttp().getResponse<HttpResponse>();
  const header = response.getHeader(CORRELATION_ID_HEADER);

  return typeof header === 'string' ? header : randomUUID();
});

/** Header obrigatório: ausente ou vazio recusa a requisição antes de tocar no banco. */
export const IdempotencyKey = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();

  return idempotencyKeyPipe.transform(request.headers[IDEMPOTENCY_KEY_HEADER]);
});
