import type { ReconciliationResponse } from '@modules/reconciliation/infra/http/reconciliation.presenter';
import type { SubmitTransactionBody } from '@modules/wagering/infra/http/wagering.dto';
import type {
  SubmissionResponse,
  TransactionResponse,
} from '@modules/wagering/infra/http/wagering.presenter';
import type {
  LedgerPageResponse,
  WalletResponse,
} from '@modules/wallet/infra/http/wallet.presenter';

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/**
 * Cliente da API apontável para qualquer instância — a que roda no processo do teste ou uma das
 * externas. Os tipos vêm dos presenters, para o teste quebrar se o contrato mudar.
 */
export function apiClient(baseUrl: string) {
  async function request<T>(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    return { status: response.status, body: (await response.json()) as T };
  }

  return {
    createWallet: (playerId: string, amount: string, currency = 'BRL') =>
      request<WalletResponse>('POST', '/wallets', {
        body: { playerId, initialBalance: { amount, currency } },
      }),

    submit: (payload: SubmitTransactionBody, idempotencyKey: string) =>
      request<SubmissionResponse>('POST', '/wagering/transactions', {
        body: payload,
        headers: { 'idempotency-key': idempotencyKey },
      }),

    /** Submissão sem o header obrigatório, para conferir a recusa de borda. */
    submitWithoutKey: (payload: SubmitTransactionBody) =>
      request<{ failureCode: string }>('POST', '/wagering/transactions', { body: payload }),

    getWallet: (walletId: string) => request<WalletResponse>('GET', `/wallets/${walletId}`),

    getLedger: (walletId: string, query = '') =>
      request<LedgerPageResponse>('GET', `/wallets/${walletId}/ledger${query}`),

    getTransaction: (transactionId: string) =>
      request<TransactionResponse>('GET', `/wagering/transactions/${transactionId}`),

    getByExternalId: (providerId: string, externalTransactionId: string) =>
      request<TransactionResponse>(
        'GET',
        `/providers/${providerId}/wagering/transactions/${externalTransactionId}`,
      ),

    reconcile: (walletId: string) =>
      request<ReconciliationResponse>('POST', `/wallets/${walletId}/reconciliation`),
  };
}

export type ApiClient = ReturnType<typeof apiClient>;
