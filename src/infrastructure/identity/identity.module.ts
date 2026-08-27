import {
  PROVIDER_IDENTITY,
  type ProviderIdentity,
  type ProviderIdentityPort,
  type ProviderIdentityRequest,
} from '@application/ports';
import { Injectable, Module } from '@nestjs/common';

/**
 * Implementação sem autenticação: aceita o `providerId` que veio declarado. Trocá-la por uma
 * que valide um token do Keycloak e leia o `providerId` de uma claim é o único ponto que muda —
 * nenhuma validação de domínio depende de quem foi resolvido aqui.
 */
@Injectable()
export class DeclaredProviderIdentity implements ProviderIdentityPort {
  async resolve(request: ProviderIdentityRequest): Promise<ProviderIdentity> {
    return { providerId: request.declaredProviderId };
  }
}

@Module({
  providers: [{ provide: PROVIDER_IDENTITY, useClass: DeclaredProviderIdentity }],
  exports: [PROVIDER_IDENTITY],
})
export class IdentityModule {}
