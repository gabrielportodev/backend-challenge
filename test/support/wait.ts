const POLL_INTERVAL_MS = 100;

/**
 * Espera uma condição assíncrona virar verdadeira. Os testes que passam pela fila não têm como
 * saber quando o worker agiu: só resta observar o efeito até ele aparecer.
 */
export async function waitUntil(
  descricao: string,
  condicao: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condicao()) {
      return;
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Esperava ${descricao} em até ${timeoutMs}ms, mas não aconteceu`);
}
