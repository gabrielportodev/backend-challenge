import {
  CheckReadinessUseCase,
  type ProbeResult,
} from '@modules/health/application/check-readiness.use-case';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { HttpResponse } from '@shared/infra/http/http-response';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  checks: ProbeResult[];
}

// Sem autenticação: é o orquestrador que consulta, e ele não tem credencial nossa.
@Controller('health')
export class HealthController {
  constructor(
    @Inject(CheckReadinessUseCase) private readonly checkReadiness: CheckReadinessUseCase,
  ) {}

  /**
   * Só responde que o processo está de pé. Não consulta dependência nenhuma de propósito: um
   * Postgres lento reiniciaria o container em vez de tirá-lo do balanceador.
   */
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** 503 enquanto alguma dependência não responde — é o que tira a instância do balanceador. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: HttpResponse): Promise<ReadinessResponse> {
    const result = await this.checkReadiness.execute();

    response.status(result.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return { status: result.ready ? 'ready' : 'not_ready', checks: result.probes };
  }
}
