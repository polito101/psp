-- CreateIndex
-- Acelera `LedgerService.getBalances`: groupBy currency+entryType con filtro merchantId + entryType IN (...).
CREATE INDEX "LedgerLine_merchant_id_entry_type_currency_idx" ON "LedgerLine"("merchant_id", "entry_type", "currency");
