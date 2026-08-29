import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { SubmitWagerTransactionUseCase } from '@modules/wagering/application/use-cases/submit-wager-transaction.use-case';
import type { SubmitTransactionBody } from '@modules/wagering/infra/http/wagering.dto';
import { createTestApp, type TestApp } from '@test/support/app';
import { type ApiClient, apiClient } from '@test/support/client';
import { expectStoredBalancesMatchLedger } from '@test/support/invariant';
import { payload } from '@test/support/payloads';

const CONSUMER = 'wager-transactions';

/**
 * A reentrega é normal em fila: o SQS entrega ao menos uma vez. Quem impede o segundo débito é o
 * inbox, gravado na mesma transação do dado financeiro.
 */
describe('inbox e reentrega', () => {
  let app: TestApp;
  let api: ApiClient;
  let submit: SubmitWagerTransactionUseCase;
  let walletId: string;

  /** Uma entrega da fila: mesmo corpo, mesma chave, só o identificador da mensagem muda. */
  const entrega = (messageId: string, idempotencyKey: string, body: SubmitTransactionBody) =>
    submit.execute({
      idempotencyKey,
      correlationId: messageId,
      payload: body,
      inbox: { consumerName: CONSUMER, messageId },
    });

  const aposta = (amount = '30.00') => payload({ walletId, money: { amount, currency: 'BRL' } });

  beforeAll(async () => {
    app = await createTestApp();
    api = apiClient(app.url);
    submit = app.app.get(SubmitWagerTransactionUseCase);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await app.reset();

    const created = await api.createWallet('player-1', '100.00');

    walletId = created.body.id;
  });

  afterEach(() => expectStoredBalancesMatchLedger(app.sql));

  it('grava o inbox junto com o dado financeiro e marca como processado', async () => {
    const resultado = await entrega('msg-1', 'k-1', aposta());

    const [registro] = await app.sql<{ payload_hash: string; processed_at: Date | null }>(
      'select payload_hash, processed_at from inbox_messages where consumer_name = ? and message_id = ?',
      [CONSUMER, 'msg-1'],
    );

    expect(resultado.transaction.status).toBe('PROCESSED');
    expect(registro?.processed_at).not.toBeNull();
    expect(registro?.payload_hash).toBe(resultado.transaction.payloadHash);
  });

  it('gera um único débito quando a mesma mensagem é entregue de novo', async () => {
    const body = aposta();
    const primeira = await entrega('msg-1', 'k-1', body);
    const segunda = await entrega('msg-1', 'k-1', body);

    expect(segunda.idempotentReplay).toBe(true);
    expect(segunda.transaction.id).toBe(primeira.transaction.id);

    const debitos = await app.sql(
      `select id from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );
    const inbox = await app.sql('select message_id from inbox_messages');

    expect(debitos).toHaveLength(1);
    expect(inbox).toHaveLength(1);

    const wallet = await api.getWallet(walletId);

    expect(wallet.body.balance.amount).toBe('70.00');
  });

  it('não duplica quando o produtor republica a mesma aposta com outro messageId', async () => {
    const body = aposta();

    await entrega('msg-1', 'k-1', body);
    const republicada = await entrega('msg-2', 'k-1', body);

    expect(republicada.idempotentReplay).toBe(true);

    const debitos = await app.sql(
      `select id from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );

    expect(debitos).toHaveLength(1);
    // A segunda entrega não chegou a commitar: o registro de inbox dela voltou atrás junto.
    expect(await app.sql('select message_id from inbox_messages')).toHaveLength(1);
  });

  it('separa a dedup por consumidor', async () => {
    const body = aposta();

    await entrega('msg-1', 'k-1', body);

    // Outro consumidor da mesma fila teria dedup própria; a barreira que sobra é a chave.
    const outro = await submit.execute({
      idempotencyKey: 'k-1',
      correlationId: 'msg-1',
      payload: body,
      inbox: { consumerName: 'outro-consumidor', messageId: 'msg-1' },
    });

    expect(outro.idempotentReplay).toBe(true);
    expect(
      await app.sql(
        `select id from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
        [walletId],
      ),
    ).toHaveLength(1);
  });

  it('recusa a mesma mensagem com payload diferente em vez de tratar como replay', async () => {
    await entrega('msg-1', 'k-1', aposta('30.00'));

    await expect(entrega('msg-1', 'k-1', aposta('40.00'))).rejects.toThrow(
      /já foi usada com outro payload/,
    );
  });
});
