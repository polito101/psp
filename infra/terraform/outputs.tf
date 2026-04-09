output "vpc_id" {
  value = aws_vpc.main.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "rds_endpoint" {
  value     = aws_db_instance.postgres.address
  sensitive = false
}

output "rds_port" {
  value = aws_db_instance.postgres.port
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "sqs_webhooks_queue_url" {
  value = aws_sqs_queue.webhooks.url
}

output "sqs_events_queue_url" {
  value = aws_sqs_queue.events.url
}
