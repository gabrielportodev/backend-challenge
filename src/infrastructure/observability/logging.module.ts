import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from '../config/env';

const CORRELATION_ID = 'x-correlation-id';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          customAttributeKeys: { reqId: 'correlationId' },
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const header = req.headers[CORRELATION_ID];
            const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
            res.setHeader(CORRELATION_ID, id);
            return id;
          },
          redact: { paths: ['req.headers.authorization', 'req.body', 'res.body'], remove: true },
          ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
        },
      }),
    }),
  ],
})
export class LoggingModule { }
