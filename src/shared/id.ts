import { uuidv7 } from 'uuidv7';

/**
 * UUIDv7: aleatório, mas crescente no tempo. Isso mantém os inserts no fim do índice e deixa
 * a ordenação por id coerente com a ordenação por data, que é o que o cursor do ledger usa.
 */
export function newId(): string {
  return uuidv7();
}
