import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from '@nestjs/common';
import { DomainError } from '@shared/domain/errors';
import {
  isRetryableDatabaseError,
  StaleWalletVersionError,
} from '@shared/infra/persistence/database-error';
import { DuplicateTransactionError } from '@shared/kernel/duplicate-transaction.error';
import { PinoLogger } from 'nestjs-pino';
import { type HttpFailureCode, statusForFailureCode } from './failure-status';
import { CORRELATION_ID_HEADER, type HttpResponse } from './http-response';

const RETRY_AFTER_SECONDS = '1';

export interface ErrorResponseBody {
  failureCode: HttpFailureCode;
  message: string;
  details: Record<string, unknown>;
  correlationId?: string;
}

interface Failure {
  status: number;
  failureCode: HttpFailureCode;
  message: string;
  details: Record<string, unknown>;
}

/**
 * Traduz qualquer exceção que escape do use case para o mesmo envelope: um `failureCode` estável
 * e o status que vem da tabela. Sem isso cada caminho de erro responderia de um jeito, e o
 * provedor teria que ler mensagem para decidir se pode reenviar.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(@Inject(PinoLogger) private readonly logger: PinoLogger) {
    logger.setContext(DomainExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const failure = this.describe(exception);
    const header = response.getHeader(CORRELATION_ID_HEADER);
    const correlationId = typeof header === 'string' ? header : undefined;

    this.log(exception, failure, correlationId);

    // Falha transitória é a única em que reenviar o mesmo pedido é a resposta certa.
    if (failure.failureCode === 'TRANSIENT_FAILURE') {
      response.setHeader('Retry-After', RETRY_AFTER_SECONDS);
    }

    const body: ErrorResponseBody = {
      failureCode: failure.failureCode,
      message: failure.message,
      details: failure.details,
      correlationId,
    };

    response.status(failure.status).json(body);
  }

  /** Classifica a exceção. Só o que é reconhecido vira mensagem para o cliente. */
  private describe(exception: unknown): Failure {
    if (exception instanceof DomainError) {
      return this.failure(exception.failureCode, exception.message, exception.details);
    }

    if (exception instanceof DuplicateTransactionError) {
      return this.failure('DUPLICATE_SUBMISSION', exception.message, {
        constraint: exception.constraint,
      });
    }

    if (exception instanceof StaleWalletVersionError) {
      return this.failure('TRANSIENT_FAILURE', 'A wallet mudou durante a operação', {
        walletId: exception.walletId,
      });
    }

    if (isRetryableDatabaseError(exception)) {
      return this.failure('TRANSIENT_FAILURE', 'Falha temporária de infraestrutura');
    }

    // Recusa do próprio framework: rota inexistente, método errado, corpo ilegível.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      return {
        status,
        failureCode: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED',
        message: exception.message,
        details: {},
      };
    }

    // Erro desconhecido não é detalhado na resposta: o detalhe fica só no log.
    return this.failure('INTERNAL_ERROR', 'Erro interno');
  }

  private failure(
    failureCode: HttpFailureCode,
    message: string,
    details: Record<string, unknown> = {},
  ): Failure {
    return { status: statusForFailureCode(failureCode), failureCode, message, details };
  }

  /** `details` carrega só identificadores, nunca o payload financeiro. */
  private log(exception: unknown, failure: Failure, correlationId?: string): void {
    const context = {
      correlationId,
      failureCode: failure.failureCode,
      status: failure.status,
      ...failure.details,
    };

    if (failure.status >= 500) {
      this.logger.error({ ...context, err: exception }, failure.message);
      return;
    }

    this.logger.warn(context, failure.message);
  }
}
