import { beforeEach, describe, expect, it } from 'bun:test';
import { GetTransactionUseCase } from '@modules/wagering/application/use-cases/get-transaction.use-case';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import { WageringController } from '@modules/wagering/infra/http/wagering.controller';
import type { SubmitTransactionBody } from '@modules/wagering/infra/http/wagering.dto';
import type { SubmissionResponse } from '@modules/wagering/infra/http/wagering.presenter';
import { CreateWalletUseCase } from '@modules/wallet/application/use-cases/create-wallet.use-case';
import type { HttpResponse } from '@shared/infra/http/http-response';
import { expectRejection } from '@test/support/failure';
import {
  ImmediateTransactionRunner,
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryWagerTransactionRepository,
  InMemoryWalletRepository,
} from '@test/support/fakes';

const PROVIDER = 'provider-a';
const AUSENTE = '00000000-0000-7000-8000-000000000000';

/** Guarda o status que o controller define pelo estado final da transação. */
class FakeResponse implements HttpResponse {
  statusCode?: number;

  status(code: number): HttpResponse {
    this.statusCode = code;
    return this;
  }

  json(): void {}
  setHeader(): void {}
  getHeader(): unknown {
    return undefined;
  }
}

let controller: WageringController;
let response: FakeResponse;
let walletId: string;

beforeEach(async () => {
  const runner = new ImmediateTransactionRunner();
  const wallets = new InMemoryWalletRepository();
  const transactions = new InMemoryWagerTransactionRepository();
  const ledger = new InMemoryLedgerRepository();
  const outbox = new InMemoryOutboxRepository();

  const createWallet = new CreateWalletUseCase(runner, wallets, transactions, ledger, outbox);
  const wallet = await createWallet.execute({
    playerId: 'player-1',
    initialBalance: { amount: '100.00', currency: 'BRL' },
    correlationId: 'corr',
  });

  walletId = wallet.id;
  response = new FakeResponse();
  controller = new WageringController(
    new SubmitWagerTransactionUseCase(
      runner,
      wallets,
      transactions,
      new InMemoryInboxRepository(),
      new WagerSettlement(wallets, transactions, ledger, outbox),
    ),
    new GetTransactionUseCase(transactions),
  );
});

const submeter = (
  over: Partial<SubmitTransactionBody> = {},
  idempotencyKey = `${PROVIDER}:${over.externalTransactionId ?? 'transaction-1'}`,
): Promise<SubmissionResponse> =>
  controller.submit(
    {
      providerId: PROVIDER,
      externalTransactionId: 'transaction-1',
      playerId: 'player-1',
      walletId,
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      ...over,
    },
    idempotencyKey,
    'corr',
    response,
  );

describe('WageringController', () => {
  it('devolve 200 e o saldo já debitado quando a aposta é aceita', async () => {
    const body = await submeter();

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('PROCESSED');
    expect(body.balance).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(body.idempotentReplay).toBe(false);
  });

  it('devolve 422 com o failureCode quando a aposta é rejeitada', async () => {
    const body = await submeter({ money: { amount: '500.00', currency: 'BRL' } });

    expect(response.statusCode).toBe(422);
    expect(body.status).toBe('REJECTED');
    expect(body.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(body.balance).toEqual({ amount: '100.00', currency: 'BRL' });
  });

  it('devolve 202 quando a referência ainda não chegou', async () => {
    const body = await submeter({
      externalTransactionId: 'refund-1',
      kind: 'REFUND',
      referenceExternalTransactionId: 'nunca-enviada',
    });

    expect(response.statusCode).toBe(202);
    expect(body.status).toBe('PENDING_REFERENCE');
  });

  it('repete a resposta original no replay da mesma chave', async () => {
    const primeira = await submeter();
    const segunda = await submeter();

    expect(segunda.transactionId).toBe(primeira.transactionId);
    expect(segunda.idempotentReplay).toBe(true);
    expect(response.statusCode).toBe(200);
  });

  it('trata mesma chave com payload diferente como conflito', async () => {
    await submeter();

    await expectRejection(
      submeter({ money: { amount: '30.00', currency: 'BRL' } }),
      'IDEMPOTENCY_CONFLICT',
    );
  });

  it('consulta a transação pelo nosso id e pelo id do provedor', async () => {
    const { transactionId } = await submeter();

    const porId = await controller.byId(transactionId);
    const porExterno = await controller.byExternalId(PROVIDER, 'transaction-1');

    expect(porId.id).toBe(transactionId);
    expect(porExterno.id).toBe(transactionId);
    expect(porId.money).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(porId.status).toBe('PROCESSED');
  });

  it('falha com TRANSACTION_NOT_FOUND no que não existe', async () => {
    await expectRejection(controller.byId(AUSENTE), 'TRANSACTION_NOT_FOUND');
    await expectRejection(controller.byExternalId(PROVIDER, 'nao-existe'), 'TRANSACTION_NOT_FOUND');
  });
});
