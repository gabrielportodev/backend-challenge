import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { HttpResponse } from '@shared/infra/http/http-response';
import { MetricsService } from './metrics.service';

// Sem autenticação, como o health: quem raspa é o Prometheus, e ele não tem credencial nossa.
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res({ passthrough: true }) response: HttpResponse): Promise<string> {
    response.setHeader('Content-Type', this.metrics.contentType);

    return this.metrics.scrape();
  }
}
