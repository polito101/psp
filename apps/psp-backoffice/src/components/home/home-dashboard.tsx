"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, CreditCard, TrendingUp } from "lucide-react";
import { fetchOpsTransactionCounts, fetchOpsVolumeHourly } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VolumeComparisonChart } from "./volume-comparison-chart";

function utcDayIsoRange(d: Date): { createdFrom: string; createdTo: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, day + 1, 0, 0, 0, 0));
  return { createdFrom: start.toISOString(), createdTo: end.toISOString() };
}

function yesterdayDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1, 12, 0, 0, 0));
}

/**
 * Home operativa: totales del día (UTC) y gráfico de volumen succeeded vs ayer.
 */
export function HomeDashboard() {
  const volumeQuery = useQuery({
    queryKey: ["home-ops-volume-hourly"],
    queryFn: () => fetchOpsVolumeHourly({ currency: "EUR" }),
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

  const countsYesterdayQuery = useQuery({
    queryKey: ["home-ops-counts-yesterday"],
    queryFn: () => {
      const yd = yesterdayDate(new Date());
      const { createdFrom, createdTo } = utcDayIsoRange(yd);
      return fetchOpsTransactionCounts({ createdFrom, createdTo });
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const succeededToday = countsTodayQuery.data?.byStatus?.succeeded ?? null;
  const succeededYesterday = countsYesterdayQuery.data?.byStatus?.succeeded ?? null;
  const totalToday = countsTodayQuery.data?.total ?? null;

  const deltaPct = useMemo(() => {
    if (succeededToday == null || succeededYesterday == null || succeededYesterday === 0) {
      return null;
    }
    return Math.round(((succeededToday - succeededYesterday) / succeededYesterday) * 1000) / 10;
  }, [succeededToday, succeededYesterday]);

  const vol = volumeQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Inicio</h1>
          <p className="mt-1 text-sm text-slate-600">
            Resumen operativo (día calendario <span className="font-medium">UTC</span>).
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pagos hoy (UTC)</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {totalToday != null ? totalToday : countsTodayQuery.isLoading ? "…" : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">Todos los estados · rango 00:00–24:00 UTC</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <TrendingUp className="size-3.5" aria-hidden />
              Succeeded hoy
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums text-emerald-800">
              {succeededToday != null ? succeededToday : countsTodayQuery.isLoading ? "…" : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            {deltaPct != null ? (
              <span className={deltaPct >= 0 ? "text-emerald-700" : "text-rose-700"}>
                {deltaPct >= 0 ? "+" : ""}
                {deltaPct}% vs ayer
              </span>
            ) : (
              "Sin baseline ayer"
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Volumen bruto (hoy vs ayer)</CardTitle>
          <CardDescription>
            Serie por hora UTC (succeeded): líneas acumuladas; el cursor compara el volumen bruto de cada hora con el
            mismo tramo de ayer. Totales arriba = succeeded acumulado hoy (hasta la hora UTC actual) y ayer (día
            completo) en <span className="font-medium">{vol?.currency ?? "EUR"}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {volumeQuery.isError ? (
            <p className="text-sm text-rose-700">{(volumeQuery.error as Error).message}</p>
          ) : vol ? (
            <VolumeComparisonChart data={vol} />
          ) : (
            <p className="text-sm text-slate-500">{volumeQuery.isLoading ? "Cargando serie…" : "Sin datos"}</p>
          )}
        </CardContent>
      </Card>

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
          <Link href="/monitor" className="font-medium text-[var(--primary)] hover:underline">
            Monitor operativo
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
