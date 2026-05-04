-- Amplica `Merchant.mid` más allá de 6 dígitos (backfill inicial con ROW_NUMBER sin LPAD truncate,
-- y allocates en runtime hasta 15 dígitos dentro de VARCHAR(16)).
ALTER TABLE "Merchant" ALTER COLUMN "mid" TYPE VARCHAR(16);
