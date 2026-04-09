resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project_name}-${var.environment}-redis-subnet"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.project_name}-${var.environment}-redis"
  description                  = "Redis PSP cache"
  engine                       = "redis"
  engine_version               = "7.1"
  node_type                    = "cache.t4g.micro"
  num_cache_clusters           = 1
  automatic_failover_enabled   = false
  # Habilitar transit + auth_token en producción (ajustar cliente Redis con TLS)
  transit_encryption_enabled = false
  at_rest_encryption_enabled = true
  subnet_group_name            = aws_elasticache_subnet_group.redis.name
  security_group_ids           = [aws_security_group.redis.id]
  port                         = 6379

  tags = {
    Name = "${var.project_name}-${var.environment}-redis"
  }
}
