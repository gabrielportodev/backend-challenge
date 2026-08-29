import 'reflect-metadata';
import { describe, expect, it } from 'bun:test';
import { HealthController } from '@modules/health/infra/http/health.controller';
import { ReconciliationController } from '@modules/reconciliation/infra/http/reconciliation.controller';
import { WageringController } from '@modules/wagering/infra/http/wagering.controller';
import { WalletController } from '@modules/wallet/infra/http/wallet.controller';
import { AuthGuard } from '@shared/infra/http/auth.guard';
import { MetricsController } from '@shared/infra/metrics/metrics.controller';

// Chave em que o `@UseGuards` grava. Ler dela é o que prova que o guard segue aplicado.
const GUARDS_METADATA = '__guards__';

function guardsOf(controller: object): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
}

describe('AuthGuard', () => {
  it('deixa passar — não há autenticação nesta entrega', () => {
    expect(new AuthGuard().canActivate()).toBe(true);
  });

  it('está aplicado a todos os endpoints de negócio', () => {
    for (const controller of [WalletController, WageringController, ReconciliationController]) {
      expect(guardsOf(controller)).toContain(AuthGuard);
    }
  });

  it('não está aplicado ao health nem ao metrics, raspados sem credencial', () => {
    expect(guardsOf(HealthController)).toEqual([]);
    expect(guardsOf(MetricsController)).toEqual([]);
  });
});
