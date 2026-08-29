# Arquitetura

As decisões que sustentam a correção financeira do serviço, e o porquê de cada uma.

## Estrutura

O primeiro corte é por contexto de negócio: `wallet` (saldo e ledger), `wagering` (a transação de
aposta), `messaging` (inbox, outbox e SQS), `reconciliation` e `health`. Dentro de cada um, `domain/`
tem os agregados e as portas, `application/` os use cases e `infra/` os adaptadores. A dependência
aponta sempre para dentro, e o domínio não importa NestJS nem MikroORM — por isso roda em teste sem
container.

## Decisões

| Tema         | Escolha                             | Por quê                                                                             |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------------------- |
| ORM          | MikroORM                            | Tem `em.transactional()` e lock pessimista de linha. Prisma é proibido pelo desafio |
| Concorrência | Lock pessimista na wallet           | Com lock otimista, 50 requisições na mesma wallet virariam 49 retentativas          |
| Isolamento   | `READ COMMITTED`                    | A linha já é travada; isolamento maior só geraria mais abortos                      |
| Idempotência | Índice único no banco               | Precisa sobreviver a restart e valer para várias instâncias                         |
| Fila         | SQS FIFO no LocalStack              | Ordem e dedup do FIFO são bônus; quem garante as regras é o banco                   |
| Moeda        | Só `BRL`, modelo pronto para várias | Redução permitida pelo desafio                                                      |
| IDs          | UUIDv7                              | Ordenável por tempo, não fragmenta o índice como o v4                               |

## Dinheiro

`0.1 + 0.2` dá `0.30000000000000004` em JavaScript, então valor nunca é número. `Money` guarda um
`Decimal` e a moeda, é imutável e recusa somar moedas diferentes. Na borda entra e sai string com
duas casas (`"100.00"`); no banco, cada valor é uma coluna `*_amount NUMERIC(19,2)` com uma
`currency CHAR(3)` por linha. Como o driver `pg` devolve `numeric` como string, o caminho é
**string → NUMERIC → string** e o número nunca vira float no meio.

## Transação única

Inbox, transação, saldo, ledger e outbox são gravados na **mesma transação SQL**:

```
1. inbox (só quando veio da fila)        5. insert no ledger
2. insert da transação (flush)           6. update do saldo
3. SELECT da wallet FOR NO KEY UPDATE    7. insert no outbox
4. validações de negócio                 8. COMMIT
```

O passo 2 vem antes do 3 de propósito: uma duplicata colide no índice único sem antes entrar na fila
do lock. Nenhuma chamada de rede acontece dentro da transação, e os repositórios escrevem na hora,
sem Unit of Work — ela reordenaria as gravações, e a ordem acima é parte da garantia.

## Concorrência

Saldo `100.00`, duas apostas de `80.00` ao mesmo tempo: sem proteção as duas leem `100.00`, as duas
debitam e o saldo vai a `-60.00`. Antes de mexer no saldo, o use case trava a linha da wallet com
`SELECT ... FOR NO KEY UPDATE`; a segunda aposta espera o commit da primeira, lê `20.00` e é
rejeitada. O lock é por linha, então wallets diferentes seguem em paralelo.

A força do lock só apareceu com os testes contra o Postgres de verdade. O insert da transação toma
`FOR KEY SHARE` na wallet por causa da FK e acontece antes do lock; `FOR UPDATE` conflita com ele, e
duas submissões na mesma wallet fechavam um ciclo até o Postgres matar uma por deadlock.
`FOR NO KEY UPDATE` é o lock que a operação realmente pede — o saldo muda, a chave não — e convive
com o `FOR KEY SHARE`. Com 20 apostas em paralelo, o tempo caiu de 57 segundos com 19 erros para
297ms sem nenhum.

A `version` da wallet entra no `WHERE` do `UPDATE` como reforço, e a última palavra é do
`CHECK (balance_amount >= 0)`. O retry cobre só `40001`, `40P01` e falha de conexão, no máximo 3
vezes: violação de índice único não é erro temporário, é replay ou conflito.

## Idempotência

A chave é o header `Idempotency-Key`, com `"{providerId}:{externalTransactionId}"` como padrão.
Junto vai o `payloadHash`: SHA-256 de um JSON canônico com só os campos de negócio, para que a ordem
em que o provedor montou o corpo não mude o hash.

| Situação                    | Resultado                                      |
| --------------------------- | ---------------------------------------------- |
| Chave nova                  | Processa                                       |
| Mesma chave, mesmo hash     | Resposta original com `idempotentReplay: true` |
| Mesma chave, hash diferente | `IDEMPOTENCY_CONFLICT`, não processa           |

O terceiro caso é o que importa: tratar payload diferente como replay devolveria "sucesso" para algo
que nunca aconteceu.

**Ninguém consulta a chave antes de inserir.** Uma checagem prévia não impede duas submissões
simultâneas de passarem juntas; quem decide é o índice único. O insert colide, a transação é
desfeita, e só então a aplicação lê a linha commitada para escolher entre replay e conflito.

## O que o banco garante

Estas constraints valem mesmo que o código falhe. As migrations são escritas à mão, porque trigger e
índice parcial não saem do diff automático.

| Onde                    | Constraint                                                          | Impede                                |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `wallets`               | `unique (player_id, currency)`                                      | Duas carteiras do mesmo jogador       |
| `wallets`               | `check (balance_amount >= 0)`                                       | Saldo negativo                        |
| `wager_transactions`    | `unique (provider_id, idempotency_key)`                             | Débito duplicado                      |
| `wager_transactions`    | `unique (provider_id, external_transaction_id)`                     | Transação repetida do provedor        |
| `wager_transactions`    | único parcial em `(reference_transaction_id, kind)` nas `PROCESSED` | Reversão em dobro                     |
| `wallet_ledger_entries` | `unique (wallet_id, transaction_id)`                                | Mais de um lançamento por transação   |
| `wallet_ledger_entries` | `check` repetindo a conta do saldo                                  | Lançamento que não fecha              |
| `wallet_ledger_entries` | trigger que barra `UPDATE`, `DELETE` e `TRUNCATE`                   | Ledger deixar de ser append-only      |
| `inbox_messages`        | PK `(consumer_name, message_id)`                                    | Processar a mesma mensagem duas vezes |

## Rejeição não é erro

Rejeição de negócio marca a transação como `REJECTED`, grava o `failureCode` e publica evento — o
registro fica, auditável. Erro é lançado e desfaz tudo, e só acontece quando não existe linha para
gravar. `LOSS` fica `PROCESSED` sem lançamento; `REFUND` e `ROLLBACK` exigem valor idêntico ao da
referência, porque reversão parcial não existe.

## Fila, inbox e outbox

O consumidor não tem regra própria: valida o envelope e chama o **mesmo** use case do HTTP, com o
mesmo schema Zod — duas entradas que chamam o mesmo use case não podem aceitar coisas diferentes.

- O **inbox** tem PK `(consumer_name, message_id)` e protege contra reentrega. A dedup usa o
  `messageId` do envelope, não o id que a fila gera, porque é a republicação do produtor que precisa
  ser reconhecida.
- O **outbox** grava o evento na mesma transação do dado financeiro e um worker publica depois do
  commit — é o que impede evento de sair antes de a transação existir. O `id` da linha é o `eventId`,
  então publicação duplicada leva o mesmo id e o consumidor deduplica.
- O `ack` vem **depois do commit**, e a publicação acontece com a transação da varredura ainda
  aberta. Nos dois casos a escolha é a mesma: preferir duplicata a perda, porque só a duplicata tem
  defesa.
- Envelope ilegível vai direto para a DLQ; `DomainError` sai da fila com o motivo logado; falha de
  infraestrutura volta com espera crescente até o quinto recebimento.

## Referência fora de ordem

Um `REFUND` ou `ROLLBACK` que chega antes da transação que referencia não é erro: a fila é
at-least-once e não garante ordem. A transação é salva como `PENDING_REFERENCE`, a API responde `202`
e um worker tenta de novo — **10 tentativas, backoff de 30s dobrando até 5 minutos**, pouco mais de
meia hora. Numa fila saudável a referência atrasada é questão de segundos, então meia hora cobre uma
drenagem lenta; e dinheiro em limbo é pior que resposta negativa, porque o provedor precisa de um
veredito para decidir se reenvia. Esgotada a janela, vira `REJECTED` com `REFERENCE_NOT_FOUND`.

## Erros e status HTTP

Existe uma classe de erro só, `DomainError`, com `failureCode`, mensagem e `details`. Quem
diferencia os casos é o código, não o tipo, e o status sai direto desta tabela:

| HTTP | `failureCode`                                                                                                                                                                        | Quando                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 400  | `VALIDATION_FAILED`, `INVALID_MONEY`                                                                                                                                                 | Payload recusado na borda                                                 |
| 404  | `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`                                                                                                                                          | Recurso não existe                                                        |
| 409  | `IDEMPOTENCY_CONFLICT`, `EXTERNAL_TRANSACTION_CONFLICT`, `DUPLICATE_SUBMISSION`, `WALLET_ALREADY_EXISTS`                                                                             | Conflito de chave ou de escrita                                           |
| 422  | `INSUFFICIENT_FUNDS`, `REVERSAL_WOULD_OVERDRAW`, `CURRENCY_MISMATCH`, `WALLET_PLAYER_MISMATCH`, `TRANSACTION_KIND_NOT_ACCEPTED`, `INVALID_TRANSACTION_STATE` e os seis `REFERENCE_*` | Pedido entendido e recusado por regra de negócio                          |
| 503  | `TRANSIENT_FAILURE`                                                                                                                                                                  | Erro retentável: reenviar é a resposta certa, e só aqui vai `Retry-After` |
| 500  | `LEDGER_ENTRY_UNBALANCED`, `INTERNAL_ERROR`                                                                                                                                          | Invariante nossa quebrada                                                 |

`INSUFFICIENT_FUNDS` e `REVERSAL_WOULD_OVERDRAW` são separados de propósito: o primeiro é resposta
esperada, o segundo indica inconsistência.

A submissão rejeitada não chega ao filtro de exceções — ela é gravada e devolvida como resultado, e
o status vem do estado final: `PROCESSED` 200, `PENDING`/`PENDING_REFERENCE` 202, `REJECTED` 422,
`FAILED` 500. Assim as cinco situações que o desafio pede para separar ficam em códigos distintos.

## Observabilidade

Logs em JSON pelo Pino, com os de negócio como objetos e não frases: `correlationId`,
`transactionId`, `walletId` e `status` são campos, porque o que se faz com eles é filtrar. O
`correlationId` é herdado do header quando o provedor manda, gerado quando não, e segue até o evento
publicado.

`GET /metrics` expõe, no formato do Prometheus, o volume por tipo e status, duplicatas, retries,
mensagens em DLQ, conflitos de lock, latência da submissão e o lag do outbox. A transação só é
contada depois do commit: contar dentro faria o rollback deixar para trás uma transação que a
métrica jura ter concluído.

`GET /health/live` não consulta dependência nenhuma — se o Postgres ficar lento, a resposta certa é
tirar a instância do balanceador, não reiniciar o container. `GET /health/ready` consulta banco e
fila e responde `503` nomeando quem falhou.

## Testes

`bun test` roda a unidade sem container. `test:integration` e `test:concurrency` rodam contra
Postgres e LocalStack de verdade, num Compose separado em portas próprias para não encostar no
ambiente de desenvolvimento. Os de concorrência sobem instâncias em processos separados, com o
Postgres como único recurso compartilhado, e o crash com commit feito e `ack` pendente é reproduzido
por construção, não por corrida contra um `SIGKILL`. Todo teste termina na mesma invariante:
`wallet.balance` igual ao saldo reconstruído pelo ledger.

## Limitações conhecidas

- **Uma moeda só.** O modelo suporta várias, mas só `BRL` foi exercitado.
- **Sem autenticação.** O `providerId` é auto-declarado.
- **O worker do outbox faz polling.** `LISTEN/NOTIFY` reduziria a latência de publicação.
- **Ordem garantida só dentro de cada wallet.** O `MessageGroupId` é o `walletId`.
- **Reconciliação sob demanda, uma wallet por vez.** Não há rotina agendada varrendo a base.
- **Sem teste de carga.** Os números aqui vieram da suíte, não de carga sustentada.
- **Com o banco fora, as rotas de leitura respondem 500 em vez de 503.** O `DriverException` do
  MikroORM assume que o erro do driver tem `stack`, e sob o Bun o do pool não tem — o `TypeError`
  resultante esconde a causa. As escritas escapam porque rodam em transação, onde o erro chega
  inteiro e é classificado como `TRANSIENT_FAILURE`.
