export const PROVIDER_IDENTITY = 'ProviderIdentity';

export interface ProviderIdentityRequest {
  /** providerId declarado no corpo da requisição ou no envelope da mensagem. */
  declaredProviderId: string;
  /** Credencial da borda. Hoje ninguém lê; com Keycloak, seria o access token. */
  credential?: string;
}

export interface ProviderIdentity {
  providerId: string;
}

/**
 * Ponto de extensão de autenticação. A implementação atual confia no que foi declarado;
 * trocá-la por uma que valide token não muda nada no restante do sistema.
 */
export interface ProviderIdentityPort {
  resolve(request: ProviderIdentityRequest): Promise<ProviderIdentity>;
}
