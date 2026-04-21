-- -----------------------------------------------------------------------------
-- Saneamiento de datos: reemplazar proveedor legado `stripe` por `mock`
-- -----------------------------------------------------------------------------
--
-- Contexto:
--   El código ya no registra ni usa `stripe` como PaymentProviderName. Las filas
--   históricas pueden seguir con selected_provider / provider = 'stripe'.
--
-- Objetivo:
--   Unificar referencias a `mock` para alinear con PAYMENT_PROVIDER_NAMES actuales
--   (mock, acme) sin tocar migraciones ya aplicadas.
--
-- Ejecución (ejemplo):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/psp-api/scripts/ops/sanitize-stripe-provider-to-mock.sql
--
--   O desde la raíz del repo con DATABASE_URL exportado:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/psp-api/scripts/ops/sanitize-stripe-provider-to-mock.sql
--
-- Revisión previa (opcional, ejecutar en sesión de solo lectura):
--   SELECT 'Payment', COUNT(*) FROM "Payment" WHERE "selected_provider" = 'stripe'
--   UNION ALL SELECT 'PaymentAttempt', COUNT(*) FROM "PaymentAttempt" WHERE "provider" = 'stripe'
--   UNION ALL SELECT 'MerchantRateTable', COUNT(*) FROM "MerchantRateTable" WHERE "provider" = 'stripe'
--   UNION ALL SELECT 'PaymentFeeQuote', COUNT(*) FROM "PaymentFeeQuote" WHERE "provider" = 'stripe'
--   UNION ALL SELECT 'PaymentSettlement', COUNT(*) FROM "PaymentSettlement" WHERE "provider" = 'stripe';
--
-- Notas:
--   - MerchantRateTable tiene índice único parcial (merchant_id, currency, provider)
--     con active_to IS NULL. Si ya existe tarifa activa `mock` y otra activa `stripe`,
--     primero se cierra la fila `stripe` (active_to = now()) y luego se renombra
--     proveedor en todas las filas `stripe` restantes (incl. históricas).
--   - Hacer copia de seguridad / snapshot antes en producción.
-- -----------------------------------------------------------------------------

BEGIN;

-- 1) Tarifas activas: evitar violar MerchantRateTable_active_merchant_currency_provider_uniq
UPDATE "MerchantRateTable" AS s
SET "active_to" = NOW()
WHERE s."provider" = 'stripe'
  AND s."active_to" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "MerchantRateTable" AS m
    WHERE m."merchant_id" = s."merchant_id"
      AND m."currency" = s."currency"
      AND m."provider" = 'mock'
      AND m."active_to" IS NULL
      AND m."id" <> s."id"
  );

-- 2) Resto de tablas con columna provider / selected_provider (sin orden crítico entre sí)
--
-- En runtime, `PaymentsV2Service` rechaza capture/cancel/refund con 409 si `Payment.selectedProvider`
-- no es un `PaymentProviderName` actual (p. ej. sigue en `stripe`): no enruta por `PAYMENTS_PROVIDER_ORDER`
-- para evitar adapter equivocado. Este script elimina ese estado bloqueado.
UPDATE "Payment"
SET "selected_provider" = 'mock'
WHERE "selected_provider" = 'stripe';

UPDATE "PaymentAttempt"
SET "provider" = 'mock'
WHERE "provider" = 'stripe';

UPDATE "PaymentFeeQuote"
SET "provider" = 'mock'
WHERE "provider" = 'stripe';

UPDATE "PaymentSettlement"
SET "provider" = 'mock'
WHERE "provider" = 'stripe';

-- 3) Tarifas: todas las filas con provider stripe -> mock (incl. las recién cerradas en paso 1)
UPDATE "MerchantRateTable"
SET "provider" = 'mock'
WHERE "provider" = 'stripe';

COMMIT;

-- Verificación post-ejecución (manual):
--   SELECT COUNT(*) AS remaining_stripe_payments FROM "Payment" WHERE "selected_provider" = 'stripe';
--   SELECT COUNT(*) AS remaining_stripe_attempts FROM "PaymentAttempt" WHERE "provider" = 'stripe';
--   SELECT COUNT(*) AS remaining_stripe_rates FROM "MerchantRateTable" WHERE "provider" = 'stripe';
--   Deben devolver 0.
