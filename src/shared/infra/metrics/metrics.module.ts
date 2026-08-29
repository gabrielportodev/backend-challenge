import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Métrica é assunto de todo módulo, como a conexão e o log. O serviço é um só para a aplicação
 * inteira — o Nest reaproveita a mesma instância do módulo em quem o importa —, então os
 * contadores do use case, do consumidor e dos workers saem no mesmo `/metrics`.
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
