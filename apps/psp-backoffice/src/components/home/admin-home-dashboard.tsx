"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Building2, CreditCard, TrendingUp } from "lucide-react";
import type { OpsVolumeHourlyMetric } from "@/lib/api/contracts";
import { fetchOpsDashboardVolumeUsd, fetchOpsTransactionCounts, fetchOpsVolumeHourly } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminHomeResumen } from "./admin-home-resumen";
import { VolumeComparisonChart } from "./volume-comparison-chart";
import { addUtcCalendarDaysFromYmd, utcYmd } from "./utc-compare-date";

function utcDayIsoRange(d: Date): { createdFrom: string; createdTo: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
  return { createdFrom: start.toISOString(), createdTo: end.toISOString() };
}

/** Home admin: resumen global + volumen USD (FX) + accesos operativos. */
export function AdminHomeDashboard() {
  const [volumeMetric, setVolumeMetric] = useState<OpsVolumeHourlyMetric>("volume_gross");
  const [compareUtcDate, setCompareUtcDate] = useState<string>(() =>
    addUtcCalendarDaysFromYmd(utcYmd(new Date()), -1),
  );

  const volumeQuery = useQuery({
    queryKey: ["home-ops-volume-hourly", volumeMetric, compareUtcDate],
    queryFn: () =>
      fetchOpsVolumeHourly({
        currency: "EUR",
        metric: volumeMetric,
        compareUtcDate,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const countsTodayQuery = useQuery({
    queryKey: ["home-ops-counts-today"],
    queryFn: () => {
      const now = new Date();
      const { createdFrom, createdTo } = utcDayIsoRange(now);
      return fetchOpsTransactionCounts({ createdFrom, createdTo });
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const volumeUsdQuery = useQuery({
    queryKey: ["home-ops-dashboard-volume-usd"],
    queryFn: () => fetchOpsDashboardVolumeUsd({}),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const succeededToday = countsTodayQuery.data?.byStatus?.succeeded ?? null;
  const totalToday = countsTodayQuery.data?.total ?? null;

  const vol = volumeQuery.data;
  const usd = volumeUsdQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Inicio (admin)</h1>
          <p className="mt-1 text-sm text-slate-600">
            Resumen operativo (día calendario <span className="font-medium">UTC</span>) y volumen agregado en USD.
          </p>
        </div>
        <Link
          href="/transactions"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
        >
          Ver transacciones
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="border-b-0 pb-4">
            <CardDescription>Pagos hoy (UTC)</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {totalToday != null ? totalToday : countsTodayQuery.isLoading ? "…" : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="border-b-0 pb-4">
            <CardDescription className="flex items-center gap-1.5">
              <TrendingUp className="size-3.5" aria-hidden />
              Succeeded hoy
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums text-emerald-800">
              {succeededToday != null ? succeededToday : countsTodayQuery.isLoading ? "…" : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="border-b-0 pb-4">
            <CardDescription>Volumen (USD minor, FX)</CardDescription>
            <CardTitle className="text-sm font-medium leading-snug text-slate-800">
              {volumeUsdQuery.isLoading
                ? "…"
                : usd
                  ? `Paid ${usd.paidUsdMinor} · Pend. ${usd.pendingUsdMinor}`
                  : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Operaciones</CardDescription>
            <CardTitle className="text-base">Backoffice</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Link href="/merchants" className="font-medium text-[var(--primary)] hover:underline">
              Directorio merchants
            </Link>
            <Link href="/operations" className="font-medium text-[var(--primary)] hover:underline">
              Liquidaciones (inbox)
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          {volumeQuery.isError ? (
            <p className="text-sm text-rose-700">{(volumeQuery.error as Error).message}</p>
          ) : vol ? (
            <VolumeComparisonChart
              data={vol}
              metric={volumeMetric}
              onMetricChange={setVolumeMetric}
              compareUtcDate={compareUtcDate}
              onCompareUtcDateChange={setCompareUtcDate}
              compareDateMin={addUtcCalendarDaysFromYmd(utcYmd(new Date()), -730)}
              compareDateMax={addUtcCalendarDaysFromYmd(utcYmd(new Date()), -1)}
            />
          ) : (
            <p className="text-sm text-slate-500">{volumeQuery.isLoading ? "Cargando serie…" : "Sin datos"}</p>
          )}
        </CardContent>
      </Card>

      <AdminHomeResumen />

      <Card className="border-dashed">
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
          <CreditCard className="size-5 text-slate-500" aria-hidden />
          <CardTitle className="text-base">Accesos rápidos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Link href="/transactions" className="font-medium text-[var(--primary)] hover:underline">
            Listado de transacciones
          </Link>
          <span className="text-slate-300">·</span>
          <Link href="/merchants" className="inline-flex items-center gap-1 font-medium text-[var(--primary)] hover:underline">
            <Building2 className="size-3.5" aria-hidden />
            Merchants
          </Link>
          <span className="text-slate-300">·</span>
          <Link href="/monitor" className="font-medium text-[var(--primary)] hover:underline">
            Monitor operativo
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
