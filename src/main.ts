import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV, type Env } from './infrastructure/config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Permite encerrar workers com seguranca no SIGTERM.
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
