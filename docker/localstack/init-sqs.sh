#!/bin/sh
set -e

QUEUE=wager-transactions.fifo
DLQ=wager-transactions-dlq.fifo
EVENTS=wagering-events.fifo

awslocal sqs create-queue --queue-name "$DLQ" --attributes FifoQueue=true

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "http://localhost:4566/000000000000/$DLQ" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs create-queue --queue-name "$QUEUE" --attributes "$(cat <<INNER
{
  "FifoQueue": "true",
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}"
}
INNER
)"

# Fila de saída do outbox. A deduplicação por conteúdo fica desligada de propósito:
# quem deduplica é o MessageDeduplicationId, que carrega o eventId.
awslocal sqs create-queue --queue-name "$EVENTS" --attributes FifoQueue=true
