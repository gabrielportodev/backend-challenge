import { CreateWalletUseCase } from '@modules/wallet/application/use-cases/create-wallet.use-case';
import { GetLedgerUseCase } from '@modules/wallet/application/use-cases/get-ledger.use-case';
import { GetWalletUseCase } from '@modules/wallet/application/use-cases/get-wallet.use-case';
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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@shared/infra/http/auth.guard';
import { CorrelationId } from '@shared/infra/http/http.decorators';
import { ZodValidationPipe } from '@shared/infra/http/zod-validation.pipe';
import {
  type CreateWalletBody,
  createWalletSchema,
  type LedgerQuery,
  ledgerQuerySchema,
  walletIdSchema,
} from './wallet.dto';
import {
  type LedgerPageResponse,
  ledgerPageResponse,
  type WalletResponse,
  walletResponse,
} from './wallet.presenter';

const walletId = () => new ZodValidationPipe(walletIdSchema);

@UseGuards(AuthGuard)
@Controller()
export class WalletController {
  constructor(
    @Inject(CreateWalletUseCase) private readonly createWallet: CreateWalletUseCase,
    @Inject(GetWalletUseCase) private readonly getWallet: GetWalletUseCase,
    @Inject(GetLedgerUseCase) private readonly getLedger: GetLedgerUseCase,
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
}
