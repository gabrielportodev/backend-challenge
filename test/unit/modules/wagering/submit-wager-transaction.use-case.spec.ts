import { beforeEach, describe, expect, it } from 'bun:test';
import {
  SubmitWagerTransactionUseCase,
  type WagerTransactionPayload,
} from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import { WagerSettlement } from '@modules/wagering/application/wager-settlement';
import { CreateWalletUseCase } from '@modules/wallet/application/use-cases/create-wallet.use-case';
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

type Submit = (
  over?: Partial<WagerTransactionPayload>,
  extra?: { idempotencyKey?: string; messageId?: string },
) => ReturnType<SubmitWagerTransactionUseCase['execute']>;

let wallets: InMemoryWalletRepository;
let transactions: InMemoryWagerTransactionRepository;
let ledger: InMemoryLedgerRepository;
let outbox: InMemoryOutboxRepository;
let inbox: InMemoryInboxRepository;
let submit: Submit;
let walletId: string;

async function scenario(initialBalance: string): Promise<void> {
  const runner = new ImmediateTransactionRunner();

  wallets = new InMemoryWalletRepository();
  transactions = new InMemoryWagerTransactionRepository();
  ledger = new InMemoryLedgerRepository();
  outbox = new InMemoryOutboxRepository();
  inbox = new InMemoryInboxRepository();

  const createWallet = new CreateWalletUseCase(runner, wallets, transactions, ledger, outbox);
  const useCase = new SubmitWagerTransactionUseCase(
    runner,
    wallets,
    transactions,
    inbox,
    new WagerSettlement(wallets, transactions, ledger, outbox),
  );

  const wallet = await createWallet.execute({
    playerId: 'player-1',
    initialBalance: { amount: initialBalance, currency: 'BRL' },
    correlationId: 'corr',
  });

  walletId = wallet.id;
  // Descarta o evento da abertura: os testes olham só o que a submissão produziu.
  outbox.messages.length = 0;

  submit = (over = {}, extra = {}) => {
    const externalTransactionId = over.externalTransactionId ?? 'tx-1';

    return useCase.execute({
      idempotencyKey: extra.idempotencyKey ?? `${PROVIDER}:${externalTransactionId}`,
      correlationId: 'corr',
      ...(extra.messageId
        ? { inbox: { consumerName: 'wager-consumer', messageId: extra.messageId } }
        : {}),
      payload: {
        providerId: PROVIDER,
        externalTransactionId,
        playerId: 'player-1',
        walletId,
        roundId: 'round-1',
        gameId: 'game-1',
        kind: 'BET',
        money: { amount: '25.00', currency: 'BRL' },
        ...over,
      },
    });
  };
}

/** A invariante que todo teste precisa fechar. */
async function ledgerBalance(): Promise<string> {
  return (await ledger.summarize(walletId, 'BRL')).balance.toString();
}

async function storedBalance(): Promise<string> {
  const wallet = await wallets.findById(walletId);

  return wallet?.balance.toString() ?? 'sem wallet';
}

describe('submissão de transação', () => {
  beforeEach(async () => {
    await scenario('100.00');
  });

  describe('regras por tipo', () => {
    it('BET debita e gera lançamento e eventos', async () => {
      const { transaction, idempotentReplay } = await submit();

      expect(transaction.status).toBe('PROCESSED');
      expect(idempotentReplay).toBe(false);
      expect(await storedBalance()).toBe('75.00');

      const entry = ledger.forWallet(walletId).at(-1);
      expect(entry?.direction).toBe('DEBIT');
      expect(entry?.balanceAfter.toString()).toBe('75.00');

      expect(outbox.types()).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged']);
      expect(await ledgerBalance()).toBe(await storedBalance());
    });

    it('WIN credita', async () => {
      await submit({ kind: 'WIN', money: { amount: '40.00', currency: 'BRL' } });

      expect(await storedBalance()).toBe('140.00');
      expect(await ledgerBalance()).toBe('140.00');
    });

    it('LOSS não move saldo e não gera lançamento', async () => {
      const { transaction } = await submit({ kind: 'LOSS' });

      expect(transaction.status).toBe('PROCESSED');
      expect(await storedBalance()).toBe('100.00');
      expect(ledger.forWallet(walletId)).toHaveLength(1);
      expect(outbox.types()).toEqual(['WagerTransactionProcessed']);
    });

    it('recusa OPENING vindo de fora', async () => {
      await expectRejection(submit({ kind: 'OPENING' }), 'TRANSACTION_KIND_NOT_ACCEPTED');
    });
  });

  describe('saldo', () => {
    it('rejeita BET sem saldo com código próprio', async () => {
      const { transaction } = await submit({ money: { amount: '500.00', currency: 'BRL' } });

      expect(transaction.status).toBe('REJECTED');
      expect(transaction.failureCode).toBe('INSUFFICIENT_FUNDS');
      expect(await storedBalance()).toBe('100.00');
      expect(outbox.types()).toEqual(['WagerTransactionRejected']);
      expect(await ledgerBalance()).toBe('100.00');
    });

    it('cenário obrigatório: duas apostas de 80 sobre saldo 100', async () => {
      const aposta = { amount: '80.00', currency: 'BRL' };
      const primeira = await submit({ externalTransactionId: 'bet-1', money: aposta });
      const segunda = await submit({ externalTransactionId: 'bet-2', money: aposta });

      expect(primeira.transaction.status).toBe('PROCESSED');
      expect(segunda.transaction.status).toBe('REJECTED');
      expect(segunda.transaction.failureCode).toBe('INSUFFICIENT_FUNDS');
      expect(await storedBalance()).toBe('20.00');

      const debitos = ledger.forWallet(walletId).filter((e) => e.direction === 'DEBIT');
      expect(debitos).toHaveLength(1);
    });
  });

  describe('idempotência', () => {
    it('mesma chave e mesmo payload devolve replay sem debitar de novo', async () => {
      const primeira = await submit();
      const replay = await submit();

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.transaction.id).toBe(primeira.transaction.id);
      expect(await storedBalance()).toBe('75.00');
      expect(ledger.forWallet(walletId).filter((e) => e.direction === 'DEBIT')).toHaveLength(1);
    });

    it('replay traz o saldo observado agora, não o do processamento original', async () => {
      await submit();
      await submit({ externalTransactionId: 'tx-2', kind: 'WIN' });

      const replay = await submit();

      expect(replay.idempotentReplay).toBe(true);
      expect(replay.wallet.balance.toString()).toBe('100.00');
    });

    it('mesma chave com payload diferente é conflito, não replay', async () => {
      await submit();

      await expectRejection(
        submit({ money: { amount: '30.00', currency: 'BRL' } }),
        'IDEMPOTENCY_CONFLICT',
      );
      expect(await storedBalance()).toBe('75.00');
    });

    it('valor equivalente com outra escala continua sendo replay', async () => {
      await submit();

      const replay = await submit({ money: { amount: '25.0', currency: 'BRL' } });

      expect(replay.idempotentReplay).toBe(true);
    });

    it('mesmo externalTransactionId sob outra chave é conflito', async () => {
      await submit();

      await expectRejection(
        submit({}, { idempotencyKey: 'outra-chave' }),
        'EXTERNAL_TRANSACTION_CONFLICT',
      );
    });

    it('redelivery da fila não duplica o débito', async () => {
      await submit({}, { messageId: 'msg-1' });
      const replay = await submit({}, { messageId: 'msg-1' });

      expect(replay.idempotentReplay).toBe(true);
      expect(await storedBalance()).toBe('75.00');
      expect(inbox.messages).toHaveLength(1);
      expect(inbox.messages[0]?.isProcessed()).toBe(true);
    });
  });

  describe('wallet', () => {
    it('rejeita wallet de outro player', async () => {
      const { transaction } = await submit({ playerId: 'player-2' });

      expect(transaction.failureCode).toBe('WALLET_PLAYER_MISMATCH');
      expect(await storedBalance()).toBe('100.00');
    });

    it('rejeita moeda diferente da wallet', async () => {
      const { transaction } = await submit({ money: { amount: '25.00', currency: 'USD' } });

      expect(transaction.failureCode).toBe('CURRENCY_MISMATCH');
      expect(await storedBalance()).toBe('100.00');
    });

    it('falha quando a wallet não existe', async () => {
      await expectRejection(
        submit({ walletId: '00000000-0000-7000-8000-000000000000' }),
        'WALLET_NOT_FOUND',
      );
    });
  });

  describe('referências', () => {
    async function betProcessada(): Promise<void> {
      await submit({ externalTransactionId: 'bet-1' });
    }

    it('REFUND sem a referência fica PENDING_REFERENCE', async () => {
      const { transaction } = await submit({
        externalTransactionId: 'ref-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'nunca-chegou',
      });

      expect(transaction.status).toBe('PENDING_REFERENCE');
      expect(outbox.types()).toEqual(['WagerTransactionPendingReference']);
      expect(await storedBalance()).toBe('100.00');
    });

    it('REFUND de uma BET PROCESSED credita de volta', async () => {
      await betProcessada();

      const { transaction } = await submit({
        externalTransactionId: 'ref-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
      });

      expect(transaction.status).toBe('PROCESSED');
      expect(await storedBalance()).toBe('100.00');
      expect(await ledgerBalance()).toBe('100.00');
    });

    it('recusa o segundo REFUND da mesma referência', async () => {
      await betProcessada();
      await submit({
        externalTransactionId: 'ref-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
      });

      const { transaction } = await submit({
        externalTransactionId: 'ref-2',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
      });

      expect(transaction.failureCode).toBe('REFERENCE_ALREADY_REVERSED');
      expect(await storedBalance()).toBe('100.00');
    });

    it('REFUND só reverte BET', async () => {
      await submit({ externalTransactionId: 'win-1', kind: 'WIN' });

      const { transaction } = await submit({
        externalTransactionId: 'ref-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'win-1',
      });

      expect(transaction.failureCode).toBe('REFERENCE_KIND_NOT_REVERSIBLE');
    });

    it('recusa reversão parcial', async () => {
      await betProcessada();

      const { transaction } = await submit({
        externalTransactionId: 'ref-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
        money: { amount: '10.00', currency: 'BRL' },
      });

      expect(transaction.failureCode).toBe('REFERENCE_AMOUNT_MISMATCH');
    });

    it('recusa referência de outra rodada', async () => {
      await betProcessada();

      const { transaction } = await submit({
        externalTransactionId: 'ref-1',
        kind: 'REFUND',
        referenceExternalTransactionId: 'bet-1',
        roundId: 'round-2',
      });

      expect(transaction.failureCode).toBe('REFERENCE_MISMATCH');
    });

    it('recusa referência que não está PROCESSED', async () => {
      await submit({
        externalTransactionId: 'pendente',
        kind: 'REFUND',
        referenceExternalTransactionId: 'nunca-chegou',
      });

      const { transaction } = await submit({
        externalTransactionId: 'ref-1',
        kind: 'ROLLBACK',
        referenceExternalTransactionId: 'pendente',
      });

      expect(transaction.failureCode).toBe('REFERENCE_NOT_PROCESSED');
    });

    it('ROLLBACK inverte a direção da referência', async () => {
      await submit({ externalTransactionId: 'win-1', kind: 'WIN' });

      const { transaction } = await submit({
        externalTransactionId: 'rb-1',
        kind: 'ROLLBACK',
        referenceExternalTransactionId: 'win-1',
      });

      expect(transaction.status).toBe('PROCESSED');
      expect(await storedBalance()).toBe('100.00');
      expect(await ledgerBalance()).toBe('100.00');
    });
  });

  describe('reversão sem saldo', () => {
    it('usa código distinto de aposta sem saldo', async () => {
      await scenario('0.00');

      await submit({ externalTransactionId: 'win-1', kind: 'WIN' });
      await submit({ externalTransactionId: 'bet-1' });
      expect(await storedBalance()).toBe('0.00');

      const { transaction } = await submit({
        externalTransactionId: 'rb-1',
        kind: 'ROLLBACK',
        referenceExternalTransactionId: 'win-1',
      });

      expect(transaction.failureCode).toBe('REVERSAL_WOULD_OVERDRAW');
      expect(await storedBalance()).toBe('0.00');
      expect(await ledgerBalance()).toBe('0.00');
    });
  });
});
