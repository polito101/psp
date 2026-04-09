# Infraestructura (Terraform)

Define la base **F0**: VPC, subredes públicas/privadas, NAT, RDS PostgreSQL 16, ElastiCache Redis 7 y colas SQS (webhooks y eventos de dominio).

## Requisitos

- Terraform >= 1.5
- Cuenta AWS y credenciales configuradas (`AWS_PROFILE` o variables de entorno)

## Uso

```bash
cd infra/terraform
export TF_VAR_db_password="$(openssl rand -base64 24)"
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

**Producción:** usar Secrets Manager para la contraseña RDS, tamaños de instancia mayores, Multi-AZ RDS, Redis con réplicas y revisión de seguridad de red (bastion, VPN).

## Desarrollo local

Para desarrollo sin AWS, usar [docker-compose](../../docker-compose.yml) en la raíz del repositorio (PostgreSQL + Redis).
