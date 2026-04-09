variable "aws_region" {
  description = "Región AWS (ej. eu-west-1)"
  type        = string
  default     = "eu-west-1"
}

variable "project_name" {
  description = "Prefijo de nombres de recursos"
  type        = string
  default     = "psp-gateway"
}

variable "environment" {
  description = "Entorno (dev, staging, prod)"
  type        = string
  default     = "staging"
}

variable "db_username" {
  type    = string
  default = "pspadmin"
}

variable "db_password" {
  description = "Contraseña maestra RDS (usar TF_VAR_db_password o Secrets Manager en prod)"
  type        = string
  sensitive   = true
}

variable "vpc_cidr" {
  default = "10.42.0.0/16"
}
