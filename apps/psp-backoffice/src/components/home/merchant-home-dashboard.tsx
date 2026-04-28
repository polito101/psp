"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  Globe2,
  Landmark,
  Receipt,
  Wallet,
} from "lucide-react";
import { fetchOpsDashboardVolumeUsd, fetchOpsTransactionCounts } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

function PortalCard(props: {
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
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Tu comercio</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Resumen del día <span className="font-medium text-slate-800">UTC</span> y accesos directos al portal de tu
              merchant.
            </p>
            <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              merchantId · <span className="text-slate-800">{merchantId}</span>
            </p>
          </div>
          <Link
            href={`/merchants/${enc}/overview`}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:opacity-95"
          >
            Ver resumen detallado
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Pagos hoy (UTC)"
          value={formatNumber(totalToday)}
          hint="Todos los estados · scoped a tu merchantId"
          icon={Receipt}
          tone="indigo"
          loading={countsTodayQuery.isLoading}
        />
        <KpiCard
          label="Volumen pagado (USD minor)"
          value={usd ? usd.paidUsdMinor : "—"}
          hint={usd ? `Pendiente: ${usd.pendingUsdMinor}` : "Conversión vía FX"}
          icon={Wallet}
          tone="emerald"
          loading={volumeUsdQuery.isLoading}
        />
        <KpiCard
          label="Fallidos / expirados"
          value={usd ? usd.failedOrExpiredUsdMinor : "—"}
          hint={usd?.conversionUnavailable ? "Conversión parcialmente no disponible" : "USD minor · FX vigente"}
          icon={Globe2}
          tone={usd?.conversionUnavailable ? "amber" : "slate"}
          loading={volumeUsdQuery.isLoading}
        />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Portal merchant</h2>
          <p className="text-sm text-slate-500">Accesos directos a las secciones de tu comercio.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PortalCard
            href={`/merchants/${enc}/payments`}
            title="Pagos"
            description="Explorador y filtros"
            icon={CreditCard}
          />
          <PortalCard
            href={`/merchants/${enc}/settlements`}
            title="Liquidaciones"
            description="Solicitudes y estado"
            icon={Wallet}
          />
          <PortalCard
            href={`/merchants/${enc}/payment-methods`}
            title="Métodos de pago"
            description="Activación por proveedor"
            icon={Receipt}
          />
          <PortalCard
            href={`/merchants/${enc}/finance`}
            title="Finanzas"
            description="Payouts y resumen contable"
            icon={Landmark}
          />
        </div>
      </section>
    </div>
  );
}
