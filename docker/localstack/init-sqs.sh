#!/bin/sh
set -e

QUEUE=wager-transactions.fifo
DLQ=wager-transactions-dlq.fifo

awslocal sqs create-queue --queue-name "$DLQ" --attributes FifoQueue=true

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "http://localhost:4566/000000000000/$DLQ" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs create-queue --queue-name "$QUEUE" --attributes "$(cat <<EOF
{
  "FifoQueue": "true",
  "VisibilityTimeout": "30",
  "RedrivePolicy": "{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}"
}
EOF
)"
