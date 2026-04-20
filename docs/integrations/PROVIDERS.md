# Proveedores: adquirente sandbox y KYC/KYB (MVP)

Selección para **desarrollo y staging**. Sustituir credenciales por contratos productivos y revisión legal/compliance antes de lanzamiento.

## Adquirente / agregador (fiat, sandbox)

| Criterio | Elección recomendada (MVP) | Alternativas |
|----------|----------------------------|--------------|
| API estable, tokenización, pruebas | **Adyen** (test) o adquirente equivalente | Checkout.com, Worldpay según región |
| Sandbox sin coste marginal | Entorno de pruebas del adquirente elegido | — |
| 3DS / SCA | Entorno de autenticación de pruebas del adquirente | — |

**Decisión MVP:** usar proveedor **mock** en esta etapa y dejar `Acme` como placeholder para la integración fiat real.

- Variables: configurar secretos del adquirente seleccionado cuando se implemente integración real.

> Si la jurisdicción o el modelo de negocio exige otro adquirente, el contrato `AcquirerPort` en código permite sustituir implementación sin cambiar el orquestador.

## Proveedor KYC/KYB (F4)

| Criterio | Elección recomendada (MVP) | Alternativas |
|----------|----------------------------|--------------|
| API unificada persona + empresa | **Sumsub** o **Onfido** + módulo KYB | Persona, Trulioo |
| Sandbox / pruebas | Cuentas de prueba del proveedor | — |
| Documentos en blob | Preintegrado con S3 presigned | — |

**Decisión MVP:** **Sumsub** como referencia en documentación y variables (`SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, webhook URL), con flujo: crear applicant → verificación documento → callback a `KycSvc`.

## Crypto (USDT, una red)

| Criterio | Elección MVP |
|----------|----------------|
| Red | **Polygon PoS** o **Tron TRC20** (elegir una para F3) |
| Nodos | Proveedor RPC (**Alchemy**, **Infura**) + indexer opcional |

**Decisión MVP:** **Polygon** + USDT (contrato oficial en Polygon); variables `CRYPTO_RPC_URL`, `CRYPTO_USDT_ADDRESS`.

## Resumen de variables (staging)

Ver [.env.example](../../apps/psp-api/.env.example) en el servicio API.
