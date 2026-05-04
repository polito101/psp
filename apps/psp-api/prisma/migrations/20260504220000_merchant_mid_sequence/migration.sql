-- Secuencia determinista para `Merchant.mid`: evita colisiones concurrentes sin bucles de reintento.
CREATE SEQUENCE "merchant_mid_seq"
  START WITH 100000
  INCREMENT BY 1
  MINVALUE 100000
  MAXVALUE 9999999999999999
  CACHE 64
  NO CYCLE;

-- Continuar después del mayor `mid` puramente numérico ya persistido (mantiene unicidad tras despliegue).
WITH mx AS (
  SELECT COALESCE(MAX(("mid")::bigint), 99999)::bigint AS v
  FROM "Merchant"
  WHERE ("mid") ~ '^[0-9]+$'
)
SELECT setval(
  'merchant_mid_seq',
  GREATEST(100000::bigint, mx.v + 1),
  false
)
FROM mx;
