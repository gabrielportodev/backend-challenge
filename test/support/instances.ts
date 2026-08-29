import { resolve } from 'node:path';
import type { Subprocess } from 'bun';

const ROOT = resolve(__dirname, '../..');
const READY_TIMEOUT_MS = 60_000;

export interface AppInstance {
  url: string;
  port: number;
  /** Encerra como um orquestrador faria, esperando a drenagem. */
  stop(): Promise<void>;
  /** Mata sem aviso, para testar o que acontece quando o processo some no meio do trabalho. */
  kill(): void;
}

export interface AppInstances {
  all: AppInstance[];
  /** Distribui a carga entre as instâncias, como um balanceador. */
  pick(index: number): AppInstance;
  stopAll(): Promise<void>;
}

async function waitUntilReady(url: string, process: Subprocess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Instância em ${url} morreu antes de ficar pronta`);
    }

    try {
      const response = await fetch(`${url}/health/ready`);

      if (response.ok) {
        return;
      }
    } catch {
      // Ainda subindo: a porta só aceita conexão depois do listen.
    }

    await Bun.sleep(200);
  }

  throw new Error(`Instância em ${url} não ficou pronta em ${READY_TIMEOUT_MS}ms`);
}

/**
 * Sobe instâncias de verdade, em processos separados, cada uma na própria porta. Assim o
 * paralelismo dos testes de concorrência é entre processos, e a única coisa compartilhada entre
 * eles é o Postgres, como em produção.
 */
export async function startInstances(count: number, basePort = 3200): Promise<AppInstances> {
  const started: AppInstance[] = [];

  for (let index = 0; index < count; index += 1) {
    const port = basePort + index;
    const url = `http://127.0.0.1:${port}`;
    const child = Bun.spawn(['bun', 'src/main.ts'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port) },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    started.push({
      url,
      port,
      stop: async () => {
        child.kill('SIGTERM');
        await child.exited;
      },
      kill: () => child.kill('SIGKILL'),
    });

    await waitUntilReady(url, child);
  }

  return {
    all: started,
    pick: (index) => started[index % started.length] as AppInstance,
    stopAll: async () => {
      await Promise.all(started.map((instance) => instance.stop()));
    },
  };
}
