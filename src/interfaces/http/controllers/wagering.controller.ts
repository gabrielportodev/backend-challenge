import { GetTransactionUseCase } from '@application/wagering/get-transaction.use-case';
import { SubmitWagerTransactionUseCase } from '@application/wagering/submit-wager-transaction.use-case';
import { Body, Controller, Get, Inject, Param, Post, Res } from '@nestjs/common';
import {
  externalTransactionIdSchema,
  providerIdSchema,
  type SubmitTransactionBody,
  submitTransactionSchema,
  transactionIdSchema,
} from '../dto/wagering.dto';
import {
  type SubmissionResponse,
  submissionResponse,
  type TransactionResponse,
  transactionResponse,
} from '../presenters';
import { statusForTransaction } from '../support/failure-status';
import { CorrelationId, IdempotencyKey } from '../support/http.decorators';
import type { HttpResponse } from '../support/http-response';
import { ZodValidationPipe } from '../support/zod-validation.pipe';

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
