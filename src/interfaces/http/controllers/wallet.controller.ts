import { CreateWalletUseCase } from '@application/wallet/create-wallet.use-case';
import { GetLedgerUseCase } from '@application/wallet/get-ledger.use-case';
import { GetWalletUseCase } from '@application/wallet/get-wallet.use-case';
import { ReconcileWalletUseCase } from '@application/wallet/reconcile-wallet.use-case';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  type CreateWalletBody,
  createWalletSchema,
  type LedgerQuery,
  ledgerQuerySchema,
  walletIdSchema,
} from '../dto/wallet.dto';
import {
  type LedgerPageResponse,
  ledgerPageResponse,
  type ReconciliationResponse,
  reconciliationResponse,
  type WalletResponse,
  walletResponse,
} from '../presenters';
import { CorrelationId } from '../support/http.decorators';
import { ZodValidationPipe } from '../support/zod-validation.pipe';

const walletId = () => new ZodValidationPipe(walletIdSchema);

@Controller()
export class WalletController {
  constructor(
    @Inject(CreateWalletUseCase) private readonly createWallet: CreateWalletUseCase,
    @Inject(GetWalletUseCase) private readonly getWallet: GetWalletUseCase,
    @Inject(GetLedgerUseCase) private readonly getLedger: GetLedgerUseCase,
    @Inject(ReconcileWalletUseCase) private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post('wallets')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createWalletSchema)) body: CreateWalletBody,
    @CorrelationId() correlationId: string,
  ): Promise<WalletResponse> {
    const wallet = await this.createWallet.execute({ ...body, correlationId });

    return walletResponse(wallet);
  }

  @Get('wallets/:walletId')
  async byId(@Param('walletId', walletId()) id: string): Promise<WalletResponse> {
    return walletResponse(await this.getWallet.execute(id));
  }

  @Get('wallets/:walletId/ledger')
  async ledger(
    @Param('walletId', walletId()) id: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQuery,
  ): Promise<LedgerPageResponse> {
    return ledgerPageResponse(await this.getLedger.execute({ walletId: id, ...query }));
  }

  /** Divergência não é corrigida aqui: só é registrada e sinalizada em `consistent`. */
  @Post('wallets/:walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(@Param('walletId', walletId()) id: string): Promise<ReconciliationResponse> {
    return reconciliationResponse(await this.reconcileWallet.execute(id));
  }
}
