import type { PipeTransform } from '@nestjs/common';
import { DomainError } from '@shared/domain/errors';
import type { ZodType } from 'zod';

/**
 * Recusa o payload na borda com o mesmo failureCode de qualquer outra validação, para o erro do
 * Zod não vazar em formato próprio. `details.issues` diz qual campo caiu e por quê.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(raiz)',
      message: issue.message,
    }));

    throw new DomainError('VALIDATION_FAILED', 'Payload inválido', { issues });
  }
}
