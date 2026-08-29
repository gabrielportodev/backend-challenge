import { Inject, Injectable } from '@nestjs/common';
import { HEALTH_PROBES, type HealthProbe } from '../domain/health-probe.port';

const PROBE_TIMEOUT_MS = 2_000;

export interface ProbeResult {
  name: string;
  ready: boolean;
  error?: string;
}

export interface ReadinessResult {
  ready: boolean;
  probes: ProbeResult[];
}

/** Sem prazo, uma dependência pendurada pendura junto a resposta que deveria denunciá-la. */
function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`sem resposta em ${ms}ms`)), ms);
  });

  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/**
 * Readiness é a pergunta "posso receber tráfego agora?". Todas as probes são consultadas mesmo
 * quando a primeira falha: quem lê precisa saber o que está fora, não só que algo está.
 */
@Injectable()
export class CheckReadinessUseCase {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: HealthProbe[]) {}

  async execute(): Promise<ReadinessResult> {
    const probes = await Promise.all(this.probes.map((probe) => this.run(probe)));

    return { ready: probes.every((probe) => probe.ready), probes };
  }

  private async run(probe: HealthProbe): Promise<ProbeResult> {
    try {
      await withTimeout(probe.check(), PROBE_TIMEOUT_MS);

      return { name: probe.name, ready: true };
    } catch (error) {
      return {
        name: probe.name,
        ready: false,
        error: error instanceof Error ? error.message : 'indisponível',
      };
    }
  }
}
