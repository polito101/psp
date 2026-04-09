# Alcance congelado — MVP (3–4 meses)

Este documento fija el **MVP** alineado con el plan de producto PSP/Gateway híbrido.

## Incluido en el MVP

| Área | Alcance |
|------|---------|
| **API única** | REST `/api/v1`: comercios (bootstrap interno), payment links, pagos, captura sandbox, balance/ledger. OpenAPI en `/api/docs`. |
| **Pay-by-link** | Creación por API; checkout HTML alojado en `GET/POST /api/v1/pay/:slug`. |
| **Fiat** | Flujo **simulado** (captura sin integración real a Stripe/Adyen en código base); variables y contrato preparados para conector. |
| **Ledger** | Líneas `available` + `fee`; comisión por `fee_bps` (por defecto 290 = 2,9%). |
| **Webhooks** | `payment.succeeded` firmado (HMAC-SHA256); secreto cifrado en reposo (`APP_ENCRYPTION_KEY`). |
| **Infra F0** | Terraform: VPC, RDS PostgreSQL, Redis ElastiCache, SQS; `docker-compose` local; CI GitHub Actions. |
| **Cumplimiento** | Documento PCI-SCOPE y proveedores (Stripe/Sumsub como referencia); **sin** certificación PCI completada en el MVP. |

## Fuera del MVP (explícito)

- Conector **producción** a adquirente (solo sandbox/simulación en servicio).
- **Crypto** on-chain completo (solo variables y doc; sin indexer en este repo salvo extensión futura).
- **KYC/KYB** integrado en UI (proveedor documentado; flujo en portal puede ser F4 posterior).
- Dashboard **Next.js** completo (la API expone datos para un front futuro).
- Enrutamiento multi-adquirente, métodos locales múltiples, motor MLM de comisiones.
- Cola asíncrona de webhooks con worker dedicado (registro en DB + entrega síncrona en MVP).

## Criterio de “listo para demo”

1. `docker compose up` + migraciones + crear comercio + crear link + abrir checkout + pago completado + saldo > 0 + webhook registrado (si URL accesible).
2. CI verde: `lint` (tsc), `test`, `terraform validate`.
