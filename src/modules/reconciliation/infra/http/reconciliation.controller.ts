import { ReconcileWalletUseCase } from '@modules/reconciliation/application/use-cases/reconcile-wallet.use-case';
import { walletIdSchema } from '@modules/wallet/infra/http/wallet.dto';
import { Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ZodValidationPipe } from '@shared/infra/http/zod-validation.pipe';
import { type ReconciliationResponse, reconciliationResponse } from './reconciliation.presenter';

@Controller()
export class ReconciliationController {
  constructor(
    @Inject(ReconcileWalletUseCase) private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  /** Divergência não é corrigida aqui: só é registrada e sinalizada em `consistent`. */
  @Post('wallets/:walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Param('walletId', new ZodValidationPipe(walletIdSchema)) walletId: string,
  ): Promise<ReconciliationResponse> {
    return reconciliationResponse(await this.reconcileWallet.execute(walletId));
  }
}
