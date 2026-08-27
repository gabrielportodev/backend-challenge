// Código estável que identifica o motivo de uma rejeição. Vai na resposta da API e no evento,
// então o provedor consegue reagir sem depender do texto da mensagem.
export type FailureCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_MONEY'
  | 'CURRENCY_MISMATCH'
  | 'INSUFFICIENT_FUNDS'
  | 'REVERSAL_WOULD_OVERDRAW'
  | 'WALLET_NOT_FOUND'
  | 'REFERENCE_NOT_FOUND'
  | 'REFERENCE_NOT_PROCESSED'
  | 'REFERENCE_KIND_NOT_REVERSIBLE'
  | 'REFERENCE_MISMATCH'
  | 'REFERENCE_AMOUNT_MISMATCH'
  | 'REFERENCE_ALREADY_REVERSED'
  | 'TRANSACTION_KIND_NOT_ACCEPTED'
  | 'INVALID_TRANSACTION_STATE'
  | 'LEDGER_ENTRY_UNBALANCED'
  | 'IDEMPOTENCY_CONFLICT';
