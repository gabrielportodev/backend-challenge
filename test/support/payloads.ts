import type { SubmitTransactionBody } from '@modules/wagering/infra/http/wagering.dto';

export const TEST_PROVIDER = 'provider-test';

/** Um pedido completo e válido; cada teste troca só o campo que lhe interessa. */
export function payload(over: Partial<SubmitTransactionBody> = {}): SubmitTransactionBody {
  return {
    providerId: TEST_PROVIDER,
    externalTransactionId: `ext-${crypto.randomUUID()}`,
    playerId: 'player-1',
    walletId: crypto.randomUUID(),
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: { amount: '10.00', currency: 'BRL' },
    ...over,
  };
}
