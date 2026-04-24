"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Landmark, Wallet } from "lucide-react";
import { fetchOpsDashboardVolumeUsd, fetchOpsTransactionCounts } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function utcDayIsoRange(d: Date): { createdFrom: string; createdTo: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
  return { createdFrom: start.toISOString(), createdTo: end.toISOString() };
}

/** Home merchant: resumen scoped + enlaces al portal. */
export function MerchantHomeDashboard({ merchantId }: { merchantId: string }) {
  const enc = encodeURIComponent(merchantId);

  const countsTodayQuery = useQuery({
    queryKey: ["merchant-home-counts", merchantId],
    queryFn: () => {
      const now = new Date();
      const { createdFrom, createdTo } = utcDayIsoRange(now);
      return fetchOpsTransactionCounts({ merchantId, createdFrom, createdTo });
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const volumeUsdQuery = useQuery({
    queryKey: ["merchant-home-usd", merchantId],
    queryFn: () => fetchOpsDashboardVolumeUsd({ merchantId }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const usd = volumeUsdQuery.data;
  const totalToday = countsTodayQuery.data?.total ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tu comercio</h1>
          <p className="mt-1 text-sm text-slate-600">Resumen de hoy (UTC) y accesos al portal merchant.</p>
        </div>
        <Link
          href={`/merchants/${enc}/overview`}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
        >
          Ver resumen detallado
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pagos hoy (UTC)</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {totalToday != null ? totalToday : countsTodayQuery.isLoading ? "…" : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Todos los estados · tu merchantId</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Volumen (USD minor, FX)</CardDescription>
            <CardTitle className="text-sm font-medium leading-snug text-slate-800">
              {volumeUsdQuery.isLoading
                ? "…"
                : usd
                  ? `Paid ${usd.paidUsdMinor} · Pend. ${usd.pendingUsdMinor} · Fallidos ${usd.failedOrExpiredUsdMinor}`
                  : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            {usd?.conversionUnavailable ? "Conversión parcialmente no disponible" : null}
          </CardContent>
        </Card>
      </div>

      <Card className="border-dashed">
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
          <Wallet className="size-5 text-slate-500" aria-hidden />
          <CardTitle className="text-base">Portal</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 text-sm">
          <Link className="font-medium text-[var(--primary)] hover:underline" href={`/merchants/${enc}/payments`}>
            Pagos / explorador
          </Link>
          <Link className="font-medium text-[var(--primary)] hover:underline" href={`/merchants/${enc}/settlements`}>
            Solicitudes de liquidación
          </Link>
          <Link
            className="font-medium text-[var(--primary)] hover:underline"
            href={`/merchants/${enc}/payment-methods`}
          >
            Métodos de pago
          </Link>
          <Link
            className="inline-flex items-center gap-1 font-medium text-[var(--primary)] hover:underline"
            href={`/merchants/${enc}/finance`}
          >
            <Landmark className="size-3.5" aria-hidden />
            Finanzas
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
