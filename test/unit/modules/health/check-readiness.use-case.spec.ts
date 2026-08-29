import { describe, expect, it } from 'bun:test';
import { CheckReadinessUseCase } from '@modules/health/application/check-readiness.use-case';
import type { HealthProbe } from '@modules/health/domain/health-probe.port';

class Probe implements HealthProbe {
  calls = 0;

  constructor(
    readonly name: string,
    private readonly falha?: string,
  ) {}

  async check(): Promise<void> {
    this.calls += 1;

    if (this.falha) {
      throw new Error(this.falha);
    }
  }
}

describe('CheckReadinessUseCase', () => {
  it('fica pronto quando todas as dependências respondem', async () => {
    const useCase = new CheckReadinessUseCase([new Probe('database'), new Probe('queue')]);

    const result = await useCase.execute();

    expect(result.ready).toBe(true);
    expect(result.probes).toEqual([
      { name: 'database', ready: true },
      { name: 'queue', ready: true },
    ]);
  });

  it('não fica pronto e nomeia quem falhou', async () => {
    const useCase = new CheckReadinessUseCase([
      new Probe('database', 'conexão recusada'),
      new Probe('queue'),
    ]);

    const result = await useCase.execute();

    expect(result.ready).toBe(false);
    expect(result.probes[0]).toEqual({
      name: 'database',
      ready: false,
      error: 'conexão recusada',
    });
    expect(result.probes[1]?.ready).toBe(true);
  });

  it('consulta todas as probes mesmo depois da primeira falhar', async () => {
    const queue = new Probe('queue');
    const useCase = new CheckReadinessUseCase([new Probe('database', 'fora'), queue]);

    await useCase.execute();

    expect(queue.calls).toBe(1);
  });
});
