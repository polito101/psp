"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Landmark, Receipt } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import {
  fetchMerchantFinancePayouts,
  fetchMerchantFinanceSummary,
  fetchMerchantFinanceTransactions,
} from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";
import { formatAmountMinor, formatShortDateTime } from "@/lib/ops-transaction-display";

type Props = { merchantId: string };

function toIsoDateTime(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const asDate = new Date(value);
  if (Number.isNaN(asDate.valueOf())) return undefined;
  return asDate.toISOString();
}

/**
 * Vista financiera por merchant: totales gross/fee/net y listados de fee quotes y payouts.
 * Divisa fija EUR en MVP (alineado con tarifas por defecto del API).
 */
export function MerchantFinanceDashboard({ merchantId }: Props) {
  const currency = "EUR";

  const [dateFromDraft, setDateFromDraft] = useState("");
  const [dateToDraft, setDateToDraft] = useState("");
  const [createdFrom, setCreatedFrom] = useState<string | undefined>();
  const [createdTo, setCreatedTo] = useState<string | undefined>();
  const [rangeError, setRangeError] = useState<string | null>(null);

  const dateRangeParams = { createdFrom, createdTo };

  const applyDateRange = useCallback(() => {
    const fromIso = toIsoDateTime(dateFromDraft);
    const toIso = toIsoDateTime(dateToDraft);
    if (fromIso && toIso && new Date(fromIso).getTime() > new Date(toIso).getTime()) {
      setRangeError("La fecha «desde» no puede ser posterior a «hasta».");
      return;
    }
    setRangeError(null);
    setCreatedFrom(fromIso);
    setCreatedTo(toIso);
  }, [dateFromDraft, dateToDraft]);

  const clearDateRange = useCallback(() => {
    setDateFromDraft("");
    setDateToDraft("");
    setRangeError(null);
    setCreatedFrom(undefined);
    setCreatedTo(undefined);
  }, []);

  const summaryQuery = useQuery({
    queryKey: ["merchant-finance-summary", merchantId, currency, createdFrom ?? "", createdTo ?? ""],
    queryFn: () => fetchMerchantFinanceSummary(merchantId, { currency, ...dateRangeParams }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const transactionsQuery = useQuery({
    queryKey: ["merchant-finance-transactions", merchantId, currency, createdFrom ?? "", createdTo ?? ""],
    queryFn: () =>
      fetchMerchantFinanceTransactions(merchantId, {
        currency,
        page: 1,
        pageSize: 25,
        ...dateRangeParams,
      }),
    staleTime: 30_000,
  });

  const payoutsQuery = useQuery({
    queryKey: ["merchant-finance-payouts", merchantId, currency, createdFrom ?? "", createdTo ?? ""],
    queryFn: () =>
      fetchMerchantFinancePayouts(merchantId, {
        currency,
        page: 1,
        pageSize: 25,
        ...dateRangeParams,
      }),
    staleTime: 30_000,
  });

  const totals = summaryQuery.data?.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/transactions"
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary)] hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Transacciones
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Finanzas del merchant</h1>
          <p className="mt-1 font-mono text-xs text-slate-600">{merchantId}</p>
          <p className="mt-1 text-sm text-slate-600">
            Bruto, comisión y neto desde <span className="font-medium">PaymentFeeQuote</span> · divisa{" "}
            <span className="font-medium">{currency}</span>
          </p>
        </div>
      </div>

      <Card className="border-dashed border-slate-200 bg-slate-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rango (UTC vía ISO)</CardTitle>
          <CardDescription>
            Filtra totales, fee quotes y payouts por <span className="font-mono">createdFrom</span> /{" "}
            <span className="font-mono">createdTo</span> (misma semántica que la API interna).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <label htmlFor="merchant-finance-from" className="text-xs font-medium text-slate-600">
              Desde
            </label>
            <Input
              id="merchant-finance-from"
              type="datetime-local"
              value={dateFromDraft}
              onChange={(e) => setDateFromDraft(e.target.value)}
              className="bg-white"
            />
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <label htmlFor="merchant-finance-to" className="text-xs font-medium text-slate-600">
              Hasta
            </label>
            <Input
              id="merchant-finance-to"
              type="datetime-local"
              value={dateToDraft}
              onChange={(e) => setDateToDraft(e.target.value)}
              className="bg-white"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={applyDateRange}>
              Aplicar
            </Button>
            <Button type="button" variant="outline" onClick={clearDateRange}>
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {rangeError ? <p className="text-sm text-rose-700">{rangeError}</p> : null}

      {summaryQuery.isError ? (
        <p className="text-sm text-rose-700">{(summaryQuery.error as Error).message}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Volumen bruto</CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums">
              {totals
                ? formatAmountMinor(totals.grossMinor, currency)
                : summaryQuery.isLoading
                  ? "…"
                  : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Suma de gross capturado (minor units agregados)</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Comisiones</CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums text-amber-900">
              {totals
                ? formatAmountMinor(totals.feeMinor, currency)
                : summaryQuery.isLoading
                  ? "…"
                  : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Fee PSP según tarifa activa al capture</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Neto liquidable (quotes)</CardDescription>
            <CardTitle className="text-xl font-semibold tabular-nums text-emerald-900">
              {totals
                ? formatAmountMinor(totals.netMinor, currency)
                : summaryQuery.isLoading
                  ? "…"
                  : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Gross − fee por transacción liquidada</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
          <Receipt className="size-5 text-slate-500" aria-hidden />
          <div>
            <CardTitle className="text-lg">Transacciones (fee quote)</CardTitle>
            <CardDescription>Últimas filas con gross / fee / net por pago</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {transactionsQuery.isError ? (
            <p className="text-sm text-rose-700">{(transactionsQuery.error as Error).message}</p>
          ) : (
            <TableContainer className="rounded-lg border border-[#e3e8ee]">
              <Table className="min-w-[900px]">
                <THead className="bg-white">
                  <tr className="border-b border-[#e3e8ee]">
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Pago</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Estado</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Bruto</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Fee</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Neto</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Modo</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Fecha</TH>
                  </tr>
                </THead>
                <TBody className="divide-y divide-[#e3e8ee] bg-white">
                  {transactionsQuery.isLoading ? (
                    <tr>
                      <TD colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Cargando…
                      </TD>
                    </tr>
                  ) : transactionsQuery.data?.items.length === 0 ? (
                    <tr>
                      <TD colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Sin fee quotes para este merchant y divisa.
                      </TD>
                    </tr>
                  ) : (
                    transactionsQuery.data?.items.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <TD className="px-4 py-3 font-mono text-xs">
                          <Link
                            href={`/payments/${row.paymentId}`}
                            className="text-[var(--primary)] hover:underline"
                          >
                            {row.paymentId}
                          </Link>
                        </TD>
                        <TD className="px-4 py-3 text-sm">{row.status}</TD>
                        <TD className="px-4 py-3 text-sm tabular-nums">
                          {formatAmountMinor(row.grossMinor, row.currency)}
                        </TD>
                        <TD className="px-4 py-3 text-sm tabular-nums">
                          {formatAmountMinor(row.feeMinor, row.currency)}
                        </TD>
                        <TD className="px-4 py-3 text-sm font-medium tabular-nums">
                          {formatAmountMinor(row.netMinor, row.currency)}
                        </TD>
                        <TD className="px-4 py-3 font-mono text-xs text-slate-600">{row.settlementMode}</TD>
                        <TD className="px-4 py-3 text-xs text-slate-600">{formatShortDateTime(row.createdAt)}</TD>
                      </tr>
                    ))
                  )}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
          <Landmark className="size-5 text-slate-500" aria-hidden />
          <div>
            <CardTitle className="text-lg">Payouts</CardTitle>
            <CardDescription>Lotes de liquidación hacia el merchant</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {payoutsQuery.isError ? (
            <p className="text-sm text-rose-700">{(payoutsQuery.error as Error).message}</p>
          ) : (
            <TableContainer className="rounded-lg border border-[#e3e8ee]">
              <Table className="min-w-[800px]">
                <THead className="bg-white">
                  <tr className="border-b border-[#e3e8ee]">
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">ID</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Estado</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Bruto</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Fee</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Neto</TH>
                    <TH className="px-4 py-3 text-xs font-semibold text-slate-600">Creado</TH>
                  </tr>
                </THead>
                <TBody className="divide-y divide-[#e3e8ee] bg-white">
                  {payoutsQuery.isLoading ? (
                    <tr>
                      <TD colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Cargando…
                      </TD>
                    </tr>
                  ) : payoutsQuery.data?.items.length === 0 ? (
                    <tr>
                      <TD colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Sin payouts registrados.
                      </TD>
                    </tr>
                  ) : (
                    payoutsQuery.data?.items.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <TD className="px-4 py-3 font-mono text-xs">{row.id}</TD>
                        <TD className="px-4 py-3 text-sm">{row.status}</TD>
                        <TD className="px-4 py-3 text-sm tabular-nums">
                          {formatAmountMinor(row.grossMinor, row.currency)}
                        </TD>
                        <TD className="px-4 py-3 text-sm tabular-nums">
                          {formatAmountMinor(row.feeMinor, row.currency)}
                        </TD>
                        <TD className="px-4 py-3 text-sm font-medium tabular-nums">
                          {formatAmountMinor(row.netMinor, row.currency)}
                        </TD>
                        <TD className="px-4 py-3 text-xs text-slate-600">{formatShortDateTime(row.createdAt)}</TD>
                      </tr>
                    ))
                  )}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
