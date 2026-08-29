import { type ApiClient, apiClient } from '@test/support/client';

/**
 * Teste de carga contra uma aplicação já no ar — não sobe nada por conta própria. O alvo padrão é
 * o Compose de desenvolvimento; passando as três portas, a carga é distribuída entre as instâncias.
 *
 *   bun run test:load
 *   LOAD_URLS=http://localhost:3000,http://localhost:3001,http://localhost:3002 bun run test:load
 */
const URLS = (process.env.LOAD_URLS ?? 'http://localhost:3000').split(',');
const CONCORRENCIA = Number(process.env.LOAD_CONCURRENCY ?? 50);
const DURACAO_SEGUNDOS = Number(process.env.LOAD_DURATION ?? 20);
const WALLETS = Number(process.env.LOAD_WALLETS ?? 5);

const SALDO_INICIAL = '1000000.00';
const VALOR_DA_APOSTA = '1.00';

interface Amostra {
  duracaoMs: number;
  status: number;
  failureCode?: string;
}

function percentil(ordenadas: number[], p: number): number {
  const indice = Math.ceil((p / 100) * ordenadas.length) - 1;

  return ordenadas[Math.min(Math.max(indice, 0), ordenadas.length - 1)] ?? 0;
}

/** Soma todas as séries de um contador do Prometheus, com ou sem rótulos. */
function metrica(texto: string, nome: string): number {
  let total = 0;

  for (const linha of texto.split('\n')) {
    if (linha.startsWith('#') || !linha.startsWith(nome)) {
      continue;
    }

    const separador = linha[nome.length];

    if (separador !== ' ' && separador !== '{') {
      continue;
    }

    total += Number(linha.slice(linha.lastIndexOf(' ') + 1)) || 0;
  }

  return total;
}

async function raspa(clientes: ApiClient[], nome: string): Promise<number> {
  const textos = await Promise.all(clientes.map((cliente) => cliente.metrics()));

  return textos.reduce((soma, texto) => soma + metrica(texto, nome), 0);
}

interface Alvo {
  walletId: string;
  playerId: string;
}

async function criaWallets(cliente: ApiClient, execucao: string): Promise<Alvo[]> {
  const respostas = await Promise.all(
    Array.from({ length: WALLETS }, (_, i) =>
      cliente.createWallet(`carga-${execucao}-${i}`, SALDO_INICIAL),
    ),
  );

  return respostas.map((resposta) => ({
    walletId: resposta.body.id,
    playerId: resposta.body.playerId,
  }));
}

/**
 * Carga fechada: cada trabalhador espera a resposta antes de disparar de novo. É a forma honesta
 * de medir latência sem inflar a fila do servidor com pedidos que ninguém está esperando.
 */
async function trabalhador(
  cliente: ApiClient,
  alvo: Alvo,
  execucao: string,
  indice: number,
  fim: number,
  amostras: Amostra[],
): Promise<void> {
  for (let n = 0; Date.now() < fim; n += 1) {
    const id = `${execucao}-${indice}-${n}`;
    const inicio = performance.now();

    try {
      const resposta = await cliente.submit(
        {
          providerId: 'carga',
          externalTransactionId: id,
          playerId: alvo.playerId,
          walletId: alvo.walletId,
          roundId: `rodada-${n}`,
          gameId: 'carga',
          kind: 'BET',
          money: { amount: VALOR_DA_APOSTA, currency: 'BRL' },
        },
        `carga:${id}`,
      );

      amostras.push({
        duracaoMs: performance.now() - inicio,
        status: resposta.status,
        failureCode: resposta.body.failureCode,
      });
    } catch (erro) {
      amostras.push({ duracaoMs: performance.now() - inicio, status: 0, failureCode: `${erro}` });
    }
  }
}

/** O lag do outbox é um gauge: só existe enquanto o worker varre, então é amostrado durante a carga. */
function amostraOutboxLag(clientes: ApiClient[], maiorLag: { valor: number }): Timer {
  return setInterval(async () => {
    const lag = await raspa(clientes, 'wagering_outbox_lag_seconds');

    maiorLag.valor = Math.max(maiorLag.valor, lag);
  }, 1_000);
}

async function esperaOutboxDrenar(clientes: ApiClient[]): Promise<number> {
  const inicio = Date.now();

  while (Date.now() - inicio < 60_000) {
    if ((await raspa(clientes, 'wagering_outbox_lag_seconds')) === 0) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return (Date.now() - inicio) / 1_000;
}

async function main(): Promise<void> {
  const clientes = URLS.map(apiClient);
  const primeiro = clientes[0] as ApiClient;
  const execucao = Date.now().toString(36);

  console.log(`Alvos: ${URLS.join(', ')}`);
  console.log(
    `Preparando ${WALLETS} wallets para ${CONCORRENCIA} trabalhadores por ${DURACAO_SEGUNDOS}s...`,
  );

  const wallets = await criaWallets(primeiro, execucao);
  const antes = {
    conflitos: await raspa(clientes, 'wagering_lock_conflicts_total'),
    retentativas: await raspa(clientes, 'wagering_retries_total'),
  };

  const amostras: Amostra[] = [];
  const maiorLag = { valor: 0 };
  const amostrador = amostraOutboxLag(clientes, maiorLag);
  const inicio = Date.now();
  const fim = inicio + DURACAO_SEGUNDOS * 1_000;

  await Promise.all(
    Array.from({ length: CONCORRENCIA }, (_, i) =>
      trabalhador(
        clientes[i % clientes.length] as ApiClient,
        wallets[i % wallets.length] as Alvo,
        execucao,
        i,
        fim,
        amostras,
      ),
    ),
  );

  clearInterval(amostrador);

  const decorridoSegundos = (Date.now() - inicio) / 1_000;
  const drenagem = await esperaOutboxDrenar(clientes);
  const depois = {
    conflitos: await raspa(clientes, 'wagering_lock_conflicts_total'),
    retentativas: await raspa(clientes, 'wagering_retries_total'),
  };

  const latencias = amostras.map((a) => a.duracaoMs).sort((a, b) => a - b);
  const aceitas = amostras.filter((a) => a.status === 200).length;
  const rejeitadas = amostras.filter((a) => a.status === 422).length;
  const erros = amostras.filter((a) => a.status !== 200 && a.status !== 422);

  // A prova de que a carga não quebrou nada: saldo tem que bater com o ledger em toda wallet.
  const relatorios = await Promise.all(wallets.map((a) => primeiro.reconcile(a.walletId)));
  const divergentes = relatorios.filter((r) => !r.body.consistent).length;

  console.log(`
## Ambiente
- alvos: ${URLS.length} instância(s) — ${URLS.join(', ')}
- wallets disputadas: ${WALLETS}
- trabalhadores simultâneos: ${CONCORRENCIA}

## Metodologia
Carga fechada: cada trabalhador envia uma BET de ${VALOR_DA_APOSTA} e só dispara a próxima depois
da resposta. Chave de idempotência única por requisição, então nada aqui é replay. Poucas wallets
para muitos trabalhadores, de propósito: é a disputa pela mesma linha que este teste quer medir.

## Resultado
- duração: ${decorridoSegundos.toFixed(1)}s
- requisições: ${amostras.length}
- throughput: ${(amostras.length / decorridoSegundos).toFixed(1)} req/s
- p50: ${percentil(latencias, 50).toFixed(1)}ms
- p95: ${percentil(latencias, 95).toFixed(1)}ms
- p99: ${percentil(latencias, 99).toFixed(1)}ms
- aceitas (200): ${aceitas}
- rejeitadas por negócio (422): ${rejeitadas}
- taxa de erro: ${((erros.length / Math.max(amostras.length, 1)) * 100).toFixed(2)}% (${erros.length})
- conflitos de lock: ${depois.conflitos - antes.conflitos}
- retentativas: ${depois.retentativas - antes.retentativas}
- maior outbox lag durante a carga: ${maiorLag.valor.toFixed(2)}s
- tempo até o outbox drenar: ${drenagem.toFixed(1)}s
- wallets com divergência entre saldo e ledger: ${divergentes} de ${wallets.length}
`);

  if (erros.length > 0) {
    const porCodigo = new Map<string, number>();

    for (const erro of erros) {
      const chave = `${erro.status} ${erro.failureCode ?? ''}`.trim();

      porCodigo.set(chave, (porCodigo.get(chave) ?? 0) + 1);
    }

    console.log('Erros por código:');
    for (const [chave, total] of porCodigo) {
      console.log(`  ${chave}: ${total}`);
    }
  }

  if (divergentes > 0) {
    console.error('\nFALHOU: a invariante saldo == ledger não fechou.');
    process.exit(1);
  }
}

void main();
