import { GetTransactionUseCase } from '@modules/wagering/application/use-cases/get-transaction.use-case';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import { CorrelationId, IdempotencyKey } from '@shared/infra/http/http.decorators';
import type { HttpResponse } from '@shared/infra/http/http-response';
import { ZodValidationPipe } from '@shared/infra/http/zod-validation.pipe';
import { statusForTransaction } from './transaction-status';
import {
  externalTransactionIdSchema,
  providerIdSchema,
  type SubmitTransactionBody,
  submitTransactionSchema,
  transactionIdSchema,
} from './wagering.dto';
import {
  type SubmissionResponse,
  submissionResponse,
  type TransactionResponse,
  transactionResponse,
} from './wagering.presenter';

@Controller()
export class WageringController {
  constructor(
    @Inject(SubmitWagerTransactionUseCase)
    private readonly submitTransaction: SubmitWagerTransactionUseCase,
    @Inject(GetTransactionUseCase) private readonly getTransaction: GetTransactionUseCase,
  ) {}

  /**
   * Rejeição de negócio não é exceção: a transação é gravada, gera evento e volta como resultado.
   * Por isso o status sai do estado em que ela terminou, e não do filtro de exceções.
   */
  @Post('wagering/transactions')
  async submit(
    @Body(new ZodValidationPipe(submitTransactionSchema)) payload: SubmitTransactionBody,
    @IdempotencyKey() idempotencyKey: string,
    @CorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<SubmissionResponse> {
    const result = await this.submitTransaction.execute({
      idempotencyKey,
      correlationId,
      payload,
    });

    response.status(statusForTransaction(result.transaction.status));

    return submissionResponse(result);
  }

  @Get('wagering/transactions/:transactionId')
  async byId(
    @Param('transactionId', new ZodValidationPipe(transactionIdSchema)) transactionId: string,
  ): Promise<TransactionResponse> {
    return transactionResponse(await this.getTransaction.byId(transactionId));
  }

  /** O caminho do provedor: ele conhece o próprio id, não o nosso. */
  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async byExternalId(
    @Param('providerId', new ZodValidationPipe(providerIdSchema)) providerId: string,
    @Param('externalTransactionId', new ZodValidationPipe(externalTransactionIdSchema))
    externalTransactionId: string,
  ): Promise<TransactionResponse> {
    return transactionResponse(
      await this.getTransaction.byExternalId(providerId, externalTransactionId),
    );
  }
}
