"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Globe2,
  LineChart,
  Receipt,
  TrendingUp,
} from "lucide-react";
import type { OpsVolumeHourlyMetric } from "@/lib/api/contracts";
import { fetchOpsDashboardVolumeUsd, fetchOpsTransactionCounts, fetchOpsVolumeHourly } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-ES").format(n);
}

function successRate(succeeded: number | null | undefined, total: number | null | undefined): string {
  if (succeeded == null || total == null || total === 0) return "—";
  const pct = (succeeded / total) * 100;
  const rounded = pct >= 100 ? 100 : Math.round(pct * 10) / 10;
  return `${new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
  }).format(rounded)} %`;
}

type KpiTone = "indigo" | "emerald" | "slate" | "amber";

const toneStyles: Record<KpiTone, { iconWrap: string; icon: string; accent: string }> = {
  indigo: {
    iconWrap: "bg-indigo-50 ring-indigo-100",
    icon: "text-[var(--primary)]",
    accent: "text-slate-900",
  },
  emerald: {
    iconWrap: "bg-emerald-50 ring-emerald-100",
    icon: "text-emerald-600",
    accent: "text-emerald-900",
  },
  slate: {
    iconWrap: "bg-slate-100 ring-slate-200",
    icon: "text-slate-700",
    accent: "text-slate-900",
  },
  amber: {
    iconWrap: "bg-amber-50 ring-amber-100",
    icon: "text-amber-700",
    accent: "text-amber-900",
  },
};

function KpiCard(props: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof CreditCard;
  tone?: KpiTone;
  loading?: boolean;
}) {
  const tone = toneStyles[props.tone ?? "indigo"];
  const Icon = props.icon;
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex-col items-start gap-3 border-b-0 pb-4">
        <div className="flex w-full items-start justify-between gap-3">
          <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {props.label}
          </CardDescription>
          <span
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-lg ring-1 ring-inset",
              tone.iconWrap,
            )}
            aria-hidden
          >
            <Icon className={cn("size-4", tone.icon)} />
          </span>
        </div>
        <CardTitle className={cn("text-2xl font-semibold tabular-nums tracking-tight", tone.accent)}>
          {props.loading ? <span className="text-slate-400">…</span> : props.value}
        </CardTitle>
      </CardHeader>
      {props.hint ? (
        <CardContent className="border-t border-slate-100 bg-slate-50/40 px-5 py-2.5 text-xs text-slate-500">
          {props.hint}
        </CardContent>
      ) : null}
    </Card>
  );
}

function QuickAccessCard(props: {
  href: string;
  title: string;
  description: string;
  icon: typeof CreditCard;
}) {
  const Icon = props.icon;
  return (
    <Link
      href={props.href}
      className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-[var(--primary)]/40 hover:shadow-md"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-[var(--primary)] ring-1 ring-inset ring-indigo-100">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{props.title}</p>
          <p className="truncate text-xs text-slate-500">{props.description}</p>
        </div>
      </div>
      <ArrowUpRight className="size-4 shrink-0 text-slate-400 transition group-hover:text-[var(--primary)]" aria-hidden />
    </Link>
  );
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

  const liveLabel = countsTodayQuery.isFetching || volumeUsdQuery.isFetching ? "Actualizando…" : "En vivo";

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-indigo-100/60 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-[var(--primary)]">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--primary)] opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-[var(--primary)]" />
              </span>
              {liveLabel}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Inicio · Backoffice admin
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Resumen operativo del día calendario <span className="font-medium text-slate-800">UTC</span> y volumen
              agregado en USD a partir del FX más reciente.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/operations"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <ClipboardList className="size-4" aria-hidden />
              Inbox liquidaciones
            </Link>
            <Link
              href="/transactions"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-95"
            >
              Ver transacciones
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Pagos hoy (UTC)"
          value={formatNumber(totalToday)}
          hint="Total de intentos del día"
          icon={Receipt}
          tone="indigo"
          loading={countsTodayQuery.isLoading}
        />
        <KpiCard
          label="Succeeded hoy"
          value={formatNumber(succeededToday)}
          hint={`Tasa de éxito: ${successRate(succeededToday, totalToday)}`}
          icon={CheckCircle2}
          tone="emerald"
          loading={countsTodayQuery.isLoading}
        />
        <KpiCard
          label="Volumen pagado (USD minor)"
          value={usd ? usd.paidUsdMinor : "—"}
          hint={usd ? `Pendiente: ${usd.pendingUsdMinor}` : "Conversión vía FX"}
          icon={TrendingUp}
          tone="slate"
          loading={volumeUsdQuery.isLoading}
        />
        <KpiCard
          label="Volumen pendiente"
          value={usd ? usd.pendingUsdMinor : "—"}
          hint={usd?.conversionUnavailable ? "Conversión parcialmente no disponible" : "USD minor · FX vigente"}
          icon={Globe2}
          tone={usd?.conversionUnavailable ? "amber" : "slate"}
          loading={volumeUsdQuery.isLoading}
        />
      </div>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex-row items-center gap-3 pb-3 pt-5">
          <span
            className="inline-flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-[var(--primary)] ring-1 ring-inset ring-indigo-100"
            aria-hidden
          >
            <LineChart className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">Volumen horario</CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Acumulado por hora UTC con comparación día a día
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 pt-2">
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

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Accesos rápidos</h2>
            <p className="text-sm text-slate-500">Atajos a las vistas operativas más usadas.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAccessCard
            href="/transactions"
            title="Transacciones"
            description="Listado y filtros operativos"
            icon={CreditCard}
          />
          <QuickAccessCard
            href="/merchants"
            title="Merchants"
            description="Directorio y panel de admin"
            icon={Building2}
          />
          <QuickAccessCard
            href="/operations"
            title="Liquidaciones"
            description="Inbox y aprobaciones"
            icon={ClipboardList}
          />
          <QuickAccessCard
            href="/monitor"
            title="Monitor operativo"
            description="Salud de proveedores y API"
            icon={Activity}
          />
        </div>
      </section>
    </div>
  );
}
