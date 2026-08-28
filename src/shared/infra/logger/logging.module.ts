import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { env } from '@config/env';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

const CORRELATION_ID = 'x-correlation-id';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        customAttributeKeys: { reqId: 'correlationId' },
        // Herda o correlationId do provedor quando vier no header, senão gera e devolve na resposta.
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const header = req.headers[CORRELATION_ID];
          const fromProvider = Array.isArray(header) ? header[0] : header;
          const correlationId = fromProvider ?? randomUUID();

          res.setHeader(CORRELATION_ID, correlationId);

          return correlationId;
        },
        redact: { paths: ['req.headers.authorization', 'req.body', 'res.body'], remove: true },
        // Log colorido só em desenvolvimento; em produção fica JSON puro.
        ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
      },
    }),
  ],
  // Reexportado para quem precisa logar com contexto estruturado, como o filtro de exceções.
  exports: [LoggerModule],
})
export class LoggingModule {}
