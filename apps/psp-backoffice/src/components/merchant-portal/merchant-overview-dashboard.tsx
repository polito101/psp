"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatShortDateTime } from "@/lib/ops-transaction-display";
import {
  fetchMerchantsOpsDetail,
  fetchOpsDashboardVolumeUsd,
  fetchOpsTransactionCounts,
} from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function utcDayIsoRange(d: Date): { createdFrom: string; createdTo: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
  return { createdFrom: start.toISOString(), createdTo: end.toISOString() };
}

export function MerchantOverviewDashboard({ merchantId }: { merchantId: string }) {
  const enc = encodeURIComponent(merchantId);

  const detailQuery = useQuery({
    queryKey: ["merchant-ops-detail", merchantId],
    queryFn: () => fetchMerchantsOpsDetail(merchantId),
    staleTime: 20_000,
  });

  const countsTodayQuery = useQuery({
    queryKey: ["merchant-overview-counts", merchantId],
    queryFn: () => {
      const now = new Date();
      const { createdFrom, createdTo } = utcDayIsoRange(now);
      return fetchOpsTransactionCounts({ merchantId, createdFrom, createdTo });
    },
    staleTime: 30_000,
  });

  const usdQuery = useQuery({
    queryKey: ["merchant-overview-usd", merchantId],
    queryFn: () => fetchOpsDashboardVolumeUsd({ merchantId }),
    staleTime: 30_000,
  });

  const m = detailQuery.data?.merchant;
  const usd = usdQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Resumen</h1>
        <p className="mt-1 text-sm text-slate-600">
          {m?.name ?? "…"} · estado:{" "}
          <span className="font-medium">{m?.isActive === false ? "inactivo" : "activo"}</span>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pagos hoy (UTC)</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {countsTodayQuery.data?.total ?? (countsTodayQuery.isLoading ? "…" : "—")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Volumen USD (FX)</CardDescription>
            <CardTitle className="text-sm font-medium text-slate-800">
              {usdQuery.isLoading
                ? "…"
                : usd
                  ? `Paid ${usd.paidUsdMinor} · Pend. ${usd.pendingUsdMinor}`
                  : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            {usd?.conversionUnavailable ? "FX incompleto para algunas divisas" : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Enlaces</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Link className="text-[var(--primary)] hover:underline" href={`/merchants/${enc}/payments`}>
              Explorador de pagos
            </Link>
            <Link className="text-[var(--primary)] hover:underline" href={`/merchants/${enc}/settlements`}>
              Liquidaciones
            </Link>
            <Link className="text-[var(--primary)] hover:underline" href={`/merchants/${enc}/payment-methods`}>
              Métodos
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actividad reciente (pagos)</CardTitle>
            <CardDescription>Últimos 10 desde API interna</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {detailQuery.isLoading ? (
              <p className="text-slate-500">Cargando…</p>
            ) : detailQuery.isError ? (
              <p className="text-rose-700">{(detailQuery.error as Error).message}</p>
            ) : (
              (detailQuery.data?.recentPayments ?? []).map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
                  <Link href={`/payments/${encodeURIComponent(p.id)}`} className="font-mono text-xs text-[var(--primary)] hover:underline">
                    {p.id.slice(0, 12)}…
                  </Link>
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">{p.status}</span>
                  <span className="text-xs text-slate-500">{formatShortDateTime(p.createdAt)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Solicitudes de settlement</CardTitle>
            <CardDescription>Últimas desde timeline</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(detailQuery.data?.settlementRequests ?? []).map((r) => (
              <div key={r.id} className="flex justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
                <span className="font-medium">{r.status}</span>
                <span className="text-xs text-slate-500">
                  {r.currency} · {r.requestedNetMinor} minor
                </span>
              </div>
            ))}
            {detailQuery.data?.settlementRequests?.length === 0 ? (
              <p className="text-slate-500">Sin solicitudes recientes.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
