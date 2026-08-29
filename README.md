# Wagering Service

Serviço financeiro de apostas e carteiras. Recebe transações de provedores de jogo por HTTP e por
fila SQS, aplica o efeito no saldo e registra tudo em um ledger append-only — saldo, transação,
lançamento e evento de saída commitam sempre na mesma transação SQL.

Tipos de transação: `BET` debita, `WIN` credita, `LOSS` não move saldo, `REFUND` devolve uma `BET`
e `ROLLBACK` inverte uma `BET`/`WIN`/`REFUND`. Toda submissão é idempotente pelo header
`Idempotency-Key`, e o serviço roda com várias instâncias em paralelo sem risco de saldo negativo
ou de débito duplicado.

O desenho e as justificativas estão em [ARCHITECTURE.md](ARCHITECTURE.md).

**Stack:** Bun 1.x · TypeScript estrito · NestJS 11 · PostgreSQL 17 · MikroORM 6 · AWS SQS
(LocalStack) · Docker Compose.

## Subindo tudo

Um comando sobe o ambiente inteiro:

```bash
docker compose up -d
```

Isso levanta, em ordem:

1. **Postgres** na porta `5433` (a `5432` costuma estar ocupada pelo Postgres da máquina);
2. **LocalStack** na `4566`, já criando as três filas FIFO — entrada, DLQ e eventos;
3. **migrate**, um container que aplica as migrations e sai;
4. **app** na porta `3000`, só depois que as migrations terminam com sucesso.

Conferindo que subiu:

```bash
curl http://localhost:3000/health/ready
```

Para derrubar, `docker compose down` — ou `docker compose down -v` para apagar também o volume do
banco.

### Múltiplas instâncias

O Compose publica a faixa `3000-3002`, então dá para rodar três instâncias contra o mesmo banco e a
mesma fila:

```bash
docker compose up -d --scale app=3
```

As instâncias competem pelas mesmas wallets e pelo mesmo outbox — é assim que a suíte de
concorrência exercita o serviço.

## Rodando fora do Docker

Útil para desenvolver com hot reload. As dependências continuam no Compose:

```bash
cp .env.example .env
docker compose up -d postgres localstack
bun install
bun run migration:up
bun run dev
```

O `.env.example` já aponta para o Postgres na `5433` e para o LocalStack na `4566`.

## Scripts

| Comando | O que faz |
| --- | --- |
| `bun run dev` | Sobe a aplicação com hot reload |
| `bun run start` | Sobe a aplicação sem watch |
| `bun run build` | Compila para `dist/` |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | Biome em modo de verificação |
| `bun run lint:fix` | Biome corrigindo e ordenando imports |
| `bun test` | Suíte de unidade (não precisa de container) |
| `bun run test:integration` | Integração contra Postgres e LocalStack reais |
| `bun run test:concurrency` | Concorrência com instâncias em processos separados |
| `bun run test:load` | Carga contra uma aplicação já no ar (ver abaixo) |
| `bun run test:infra:up` | Sobe os containers dedicados aos testes |
| `bun run test:infra:down` | Derruba os containers de teste e apaga o volume |
| `bun run migration:up` | Aplica as migrations pendentes |
| `bun run migration:down` | Reverte a última migration |
| `bun run migration:list` | Lista as migrations aplicadas |
| `bun run migration:create` | Gera uma nova migration a partir do schema |

### Testes

`bun test` sozinho roda só a unidade. As outras duas suítes precisam da infraestrutura de teste,
que é um Compose separado (`docker-compose.test.yml`) e não conflita com o ambiente de
desenvolvimento:

```bash
bun run test:infra:up
bun run test:integration
bun run test:concurrency
bun run test:infra:down
```

O teste de carga é diferente: ele não sobe nada, aponta para uma aplicação que já está rodando —
por padrão a do Compose, em `http://localhost:3000`. Para distribuir a carga entre as três
instâncias:

```bash
docker compose up -d --scale app=3
LOAD_URLS=http://localhost:3000,http://localhost:3001,http://localhost:3002 bun run test:load
```

`LOAD_CONCURRENCY`, `LOAD_DURATION` e `LOAD_WALLETS` ajustam trabalhadores simultâneos, duração em
segundos e quantas carteiras são disputadas.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/wallets` | Cria a carteira com saldo inicial |
| `GET` | `/wallets/:walletId` | Saldo e versão atuais |
| `GET` | `/wallets/:walletId/ledger` | Lançamentos paginados (`cursor`, `limit`) |
| `POST` | `/wagering/transactions` | Submete uma transação |
| `GET` | `/wagering/transactions/:transactionId` | Consulta pelo id interno |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta pelo id do provedor |
| `POST` | `/wallets/:walletId/reconciliation` | Confere o saldo contra o ledger |
| `GET` | `/health/live` · `/health/ready` | Liveness e readiness |
| `GET` | `/metrics` | Métricas no formato do Prometheus |

Valores monetários são sempre string decimal com duas casas, nunca número — `"amount": "100.00"`.

### Criando uma carteira

```bash
curl -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{
    "playerId": "player-1",
    "initialBalance": { "amount": "100.00", "currency": "BRL" }
  }'
```

```json
{
  "id": "0198f3a1-....",
  "playerId": "player-1",
  "balance": { "amount": "100.00", "currency": "BRL" },
  "version": 1
}
```

### Submetendo uma aposta

O header `Idempotency-Key` é obrigatório. Repetir a mesma chave com o mesmo corpo devolve a
resposta original com `idempotentReplay: true`; repetir com corpo diferente é conflito.

```bash
curl -X POST http://localhost:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-1:tx-1' \
  -d '{
    "providerId": "provider-1",
    "externalTransactionId": "tx-1",
    "playerId": "player-1",
    "walletId": "0198f3a1-....",
    "roundId": "round-1",
    "gameId": "game-1",
    "kind": "BET",
    "money": { "amount": "80.00", "currency": "BRL" }
  }'
```

```json
{
  "transactionId": "0198f3a2-....",
  "status": "PROCESSED",
  "balance": { "amount": "20.00", "currency": "BRL" },
  "idempotentReplay": false
}
```

Uma rejeição de negócio — saldo insuficiente, por exemplo — também grava a transação e volta com
`status: "REJECTED"` e um `failureCode` estável, em vez de um erro genérico. `REFUND` e `ROLLBACK`
levam `referenceExternalTransactionId` apontando para a transação original.

## Publicando na fila

A mesma submissão pode chegar pela fila de entrada. O envelope carrega a chave de idempotência no
corpo, já que a fila não tem header onde colocá-la:

```bash
docker compose exec localstack awslocal sqs send-message \
  --queue-url http://localhost:4566/000000000000/wager-transactions.fifo \
  --message-group-id "0198f3a1-...." \
  --message-deduplication-id "provider-1:tx-2" \
  --message-body '{
    "messageId": "provider-1:tx-2",
    "type": "WagerTransactionRequested",
    "occurredAt": "2026-01-01T00:00:00.000Z",
    "data": {
      "idempotencyKey": "provider-1:tx-2",
      "providerId": "provider-1",
      "externalTransactionId": "tx-2",
      "playerId": "player-1",
      "walletId": "0198f3a1-....",
      "roundId": "round-1",
      "gameId": "game-1",
      "kind": "WIN",
      "money": { "amount": "50.00", "currency": "BRL" }
    }
  }'
```

Os eventos de saída (`WagerTransactionProcessed`, `WagerTransactionRejected`,
`WalletBalanceChanged`, `WagerTransactionPendingReference`) são publicados pelo worker do outbox na
fila `wagering-events.fifo`:

```bash
docker compose exec localstack awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/wagering-events.fifo
```

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` ou `production` |
| `PORT` | `3000` | Porta HTTP |
| `LOG_LEVEL` | `info` | Nível do Pino |
| `DATABASE_URL` | — | URL de conexão do Postgres |
| `AWS_REGION` | `us-east-1` | Região usada pelo cliente SQS |
| `AWS_ENDPOINT_URL` | — | Endpoint do LocalStack; vazio em produção |
| `AWS_ACCESS_KEY_ID` | — | Credencial do SDK (`test` no LocalStack) |
| `AWS_SECRET_ACCESS_KEY` | — | Credencial do SDK (`test` no LocalStack) |
| `SQS_WAGER_QUEUE_URL` | — | Fila de entrada |
| `SQS_WAGER_DLQ_URL` | — | Fila morta da entrada |
| `SQS_EVENTS_QUEUE_URL` | — | Fila de saída dos eventos |

As variáveis sem padrão são obrigatórias: o processo valida o ambiente na subida e falha se faltar
alguma. `.env.example` traz o conjunto pronto para desenvolvimento local e `.env.test` o das suítes
de integração e concorrência.
