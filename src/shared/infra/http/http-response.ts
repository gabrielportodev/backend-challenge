/** O mínimo necessário da resposta HTTP, para não depender dos tipos do Express. */
export interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  getHeader(name: string): unknown;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
