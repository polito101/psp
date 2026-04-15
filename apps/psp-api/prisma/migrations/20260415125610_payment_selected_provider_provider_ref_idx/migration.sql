-- CreateIndex
CREATE INDEX "Payment_selected_provider_provider_ref_idx" ON "Payment"("selected_provider", "provider_ref");
