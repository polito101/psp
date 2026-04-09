resource "aws_sqs_queue" "webhooks_dlq" {
  name                      = "${var.project_name}-${var.environment}-webhooks-dlq"
  message_retention_seconds = 1209600
  tags = {
    Name = "${var.project_name}-webhooks-dlq"
  }
}

resource "aws_sqs_queue" "webhooks" {
  name = "${var.project_name}-${var.environment}-webhooks"

  visibility_timeout_seconds = 60
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.webhooks_dlq.arn
    maxReceiveCount     = 5
  })

  tags = {
    Name = "${var.project_name}-webhooks"
  }
}

resource "aws_sqs_queue" "events_dlq" {
  name                      = "${var.project_name}-${var.environment}-events-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "events" {
  name = "${var.project_name}-${var.environment}-events"

  visibility_timeout_seconds = 120
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.events_dlq.arn
    maxReceiveCount     = 5
  })
}
