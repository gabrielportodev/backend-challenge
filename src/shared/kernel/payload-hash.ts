import { createHash } from 'node:crypto';

/**
 * JSON com as chaves ordenadas em todos os níveis: o mesmo conteúdo sempre gera o mesmo texto,
 * independente da ordem em que o provedor montou os campos.
 */
export function canonicalJson(value: unknown): string {
  // Passa pelo JSON antes de ordenar: datas viram string e campos ausentes somem, então
  // sortKeys só precisa lidar com objeto, array e primitivo.
  return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value))));
}

/** Impressão digital dos campos de negócio: é ela que separa replay de conflito de idempotência. */
export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortKeys(source[key]);
  }

  return sorted;
}
