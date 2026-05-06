"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMerchantProviderRates, fetchPaymentProviders, upsertMerchantProviderRate } from "@/lib/api/client";
import type { MerchantProviderRateRow, PaymentProviderConfigRow } from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

type FormState = {
  providerId: string;
  countryCode: string;
  percentage: string;
  fixed: string;
  minRateDiscount: string;
  fxSpread: string;
  fxMarkup: string;
  cashMinAmount: string;
  creditCardMinAmount: string;
  cryptoMinAmount: string;
  onlineMinAmount: string;
  disableIndustryValidation: boolean;
  applyToCustomer: boolean;
  cashEnabled: boolean;
  creditCardEnabled: boolean;
  cryptoEnabled: boolean;
  onlineEnabled: boolean;
  isActive: boolean;
};

function emptyForm(): FormState {
  return {
    providerId: "",
    countryCode: "",
    percentage: "0",
    fixed: "0",
    minRateDiscount: "0",
    fxSpread: "0",
    fxMarkup: "0",
    cashMinAmount: "0",
    creditCardMinAmount: "0",
    cryptoMinAmount: "0",
    onlineMinAmount: "0",
    disableIndustryValidation: false,
    applyToCustomer: false,
    cashEnabled: true,
    creditCardEnabled: true,
    cryptoEnabled: true,
    onlineEnabled: true,
    isActive: true,
  };
}

export function MerchantProviderRatesPanel({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [note, setNote] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ["payment-providers"],
    queryFn: fetchPaymentProviders,
    staleTime: 60_000,
  });

  const ratesQuery = useQuery({
    queryKey: ["merchant-provider-rates", merchantId],
    queryFn: () => fetchMerchantProviderRates(merchantId),
    staleTime: 10_000,
  });

  const upsert = useMutation({
    mutationFn: () =>
      upsertMerchantProviderRate(merchantId, {
        providerId: form.providerId.trim(),
        countryCode: form.countryCode.trim().toUpperCase(),
        percentage: Number(form.percentage),
        fixed: Number(form.fixed),
        minRateDiscount: Number(form.minRateDiscount || 0),
        applyToCustomer: form.applyToCustomer,
        fxSpread: Number(form.fxSpread || 0),
        fxMarkup: Number(form.fxMarkup || 0),
        disableIndustryValidation: form.disableIndustryValidation,
        cashEnabled: form.cashEnabled,
        creditCardEnabled: form.creditCardEnabled,
        cryptoEnabled: form.cryptoEnabled,
        onlineEnabled: form.onlineEnabled,
        cashMinAmount: Number(form.cashMinAmount || 0),
        creditCardMinAmount: Number(form.creditCardMinAmount || 0),
        cryptoMinAmount: Number(form.cryptoMinAmount || 0),
        onlineMinAmount: Number(form.onlineMinAmount || 0),
        isActive: form.isActive,
      }),
    onSuccess: async () => {
      setNote("Tarifa guardada.");
      setOpen(false);
      setForm(emptyForm());
      await qc.invalidateQueries({ queryKey: ["merchant-provider-rates", merchantId] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const providers = providersQuery.data ?? [];
  const rows = ratesQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Tarifas por proveedor y país</CardTitle>
          <CardDescription>Porcentaje, fijo, mínimos por canal y flags de validación.</CardDescription>
        </div>
        <Button type="button" variant="primary" onClick={() => setOpen(true)}>
          Añadir / actualizar tarifa
        </Button>
      </CardHeader>
      <CardContent>
        {note ? <p className="mb-3 text-sm text-slate-700">{note}</p> : null}
        {ratesQuery.isLoading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : ratesQuery.isError ? (
          <p className="text-sm text-rose-700">{(ratesQuery.error as Error).message}</p>
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>País</TH>
                  <TH>Proveedor</TH>
                  <TH>%</TH>
                  <TH>Fijo</TH>
                  <TH>FX spread</TH>
                  <TH>FX markup</TH>
                  <TH>Sin valid. industria</TH>
                  <TH>Activo</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r: MerchantProviderRateRow) => (
                  <tr key={r.id}>
                    <TD>{r.countryCode}</TD>
                    <TD>{r.provider?.name ?? r.providerId}</TD>
                    <TD className="font-mono text-sm">{r.percentage}</TD>
                    <TD className="font-mono text-sm">{r.fixed}</TD>
                    <TD className="font-mono text-sm">{r.fxSpread}</TD>
                    <TD className="font-mono text-sm">{r.fxMarkup}</TD>
                    <TD>{r.disableIndustryValidation ? "Sí" : "No"}</TD>
                    <TD>{r.isActive ? "Sí" : "No"}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}

        <Dialog
          open={open}
          onOpenChange={(o) => !o && setOpen(false)}
          title="Tarifa merchant–proveedor"
          description="Upsert por merchantId + providerId + countryCode (v2 configuration API)."
        >
          <div className="mt-3 grid max-h-[70vh] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
            <label className="text-sm md:col-span-2">
              <span className="text-xs font-medium text-slate-600">Proveedor</span>
              <Select
                className="mt-1"
                value={form.providerId}
                onChange={(e) => setForm((f) => ({ ...f, providerId: e.target.value }))}
              >
                <option value="">Selecciona…</option>
                {providers.map((p: PaymentProviderConfigRow) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">País (ISO2)</span>
              <Input
                className="mt-1 uppercase"
                maxLength={2}
                value={form.countryCode}
                onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.toUpperCase() }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Porcentaje (0–100)</span>
              <Input
                className="mt-1"
                value={form.percentage}
                onChange={(e) => setForm((f) => ({ ...f, percentage: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Cargo fijo</span>
              <Input
                className="mt-1"
                value={form.fixed}
                onChange={(e) => setForm((f) => ({ ...f, fixed: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Descuento mín. tarifa</span>
              <Input
                className="mt-1"
                value={form.minRateDiscount}
                onChange={(e) => setForm((f) => ({ ...f, minRateDiscount: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">FX spread</span>
              <Input
                className="mt-1"
                value={form.fxSpread}
                onChange={(e) => setForm((f) => ({ ...f, fxSpread: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">FX markup</span>
              <Input
                className="mt-1"
                value={form.fxMarkup}
                onChange={(e) => setForm((f) => ({ ...f, fxMarkup: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Mín. cash</span>
              <Input
                className="mt-1"
                value={form.cashMinAmount}
                onChange={(e) => setForm((f) => ({ ...f, cashMinAmount: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Mín. tarjeta</span>
              <Input
                className="mt-1"
                value={form.creditCardMinAmount}
                onChange={(e) => setForm((f) => ({ ...f, creditCardMinAmount: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Mín. crypto</span>
              <Input
                className="mt-1"
                value={form.cryptoMinAmount}
                onChange={(e) => setForm((f) => ({ ...f, cryptoMinAmount: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-medium text-slate-600">Mín. online</span>
              <Input
                className="mt-1"
                value={form.onlineMinAmount}
                onChange={(e) => setForm((f) => ({ ...f, onlineMinAmount: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={form.disableIndustryValidation}
                onChange={(e) => setForm((f) => ({ ...f, disableIndustryValidation: e.target.checked }))}
              />
              Desactivar validación de industria
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.applyToCustomer}
                onChange={(e) => setForm((f) => ({ ...f, applyToCustomer: e.target.checked }))}
              />
              Aplicar a cliente
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Activo
            </label>
            <div className="md:col-span-2 flex flex-wrap gap-3 border-t border-slate-100 pt-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.cashEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, cashEnabled: e.target.checked }))}
                />
                Cash
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.creditCardEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, creditCardEnabled: e.target.checked }))}
                />
                Tarjeta
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.cryptoEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, cryptoEnabled: e.target.checked }))}
                />
                Crypto
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.onlineEnabled}
                  onChange={(e) => setForm((f) => ({ ...f, onlineEnabled: e.target.checked }))}
                />
                Online
              </label>
            </div>
            <div className="flex gap-2 md:col-span-2">
              <Button type="button" variant="primary" disabled={upsert.isPending} onClick={() => upsert.mutate()}>
                Guardar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </Dialog>
      </CardContent>
    </Card>
  );
}
