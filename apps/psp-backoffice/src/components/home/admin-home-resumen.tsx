"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronDown, CirclePlus } from "lucide-react";
import type { OpsPaymentsSummaryChartResponse } from "@/lib/api/contracts";
import { fetchOpsPaymentsSummaryDaily, fetchOpsPaymentsSummaryHourly } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { amountMinorToBigInt, formatAmountMinor } from "@/lib/ops-transaction-display";
import { cn } from "@/lib/utils";
import { OpsCumulativeHourlyChart } from "./ops-cumulative-hourly-chart";
import {
  addUtcCalendarDaysYmd,
  computeCompareYmdRange,
  defaultSummaryTodayYmd,
  OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC,
  type SummaryComparatorMode,
  utcInclusiveDayCountYmd,
  utcLastNDaysInclusiveUntilTodayYmd,
  utcTodayYmd,
  utcYmdRangeToIsoRange,
} from "./admin-summary-range";

const SUMMARY_CURRENCY = "EUR";

type IntervalPreset = "today" | "last7" | "last30" | "custom";

const pillSelectClass =
  "h-9 min-w-0 cursor-pointer appearance-none border-0 bg-transparent py-0 pl-1 pr-6 text-sm font-medium outline-none focus:ring-0";

const pillWrapClass =
  "relative inline-flex h-10 max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 pl-3.5 text-sm shadow-sm";

function parseBig(s: string): bigint {
  try {
    return BigInt(s.trim());
  } catch {
    return 0n;
  }
}

function sumSeriesStrings(arr: string[]): bigint {
  return arr.reduce((a, s) => a + parseBig(s), 0n);
}

function formatBigIntCount(n: bigint): string {
  if (n <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return new Intl.NumberFormat("es-ES").format(Number(n));
  }
  return n.toString();
}

function deltaPct(current: bigint, prev: bigint): number | null {
  if (prev === 0n) {
    if (current === 0n) return 0;
    return null;
  }
  return Number(((current - prev) * 10000n) / prev) / 100;
}

function formatDeltaPct(p: number | null): string {
  if (p == null) return "—";
  const rounded = Math.abs(p) >= 100 ? Math.round(p) : Math.round(p * 10) / 10;
  const num = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    signDisplay: "exceptZero",
  }).format(rounded);
  return `${num} %`;
}

function ymdToUtcDate(ymd: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
}

function formatYmdRangeLabel(fromYmd: string, toYmd: string): string {
  const fmt = new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(ymdToUtcDate(fromYmd))} → ${fmt.format(ymdToUtcDate(toYmd))}`;
}

function formatRelativeUpdated(updatedAt: number): string {
  const sec = Math.round((Date.now() - updatedAt) / 1000);
  if (sec < 10) return "hace un momento";
  if (sec < 60) return `hace ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}

/** Acumulado horario UTC (corte a hora actual si `dayYmd` es hoy). */
function incrementalToCumulativeToday(
  incr: string[],
  dayYmd: string,
): { series: (bigint | null)[]; parseInvalid: boolean } {
  const isToday = dayYmd === utcTodayYmd();
  const hNow = new Date().getUTCHours();
  let s = 0n;
  let parseInvalid = false;
  const out: (bigint | null)[] = [];
  for (let i = 0; i < 24; i++) {
    const raw = incr[i] ?? "0";
    const step = amountMinorToBigInt(raw);
    if (step == null) {
      parseInvalid = true;
      out.push(null);
      continue;
    }
    s += step;
    if (isToday && i > hNow) out.push(null);
    else out.push(s);
  }
  return { series: out, parseInvalid };
}

function incrementalToCumulativeCompare(incr: string[]): {
  series: (bigint | null)[];
  parseInvalid: boolean;
} {
  let s = 0n;
  let parseInvalid = false;
  const out: (bigint | null)[] = [];
  for (let i = 0; i < 24; i++) {
    const raw = incr[i] ?? "0";
    const step = amountMinorToBigInt(raw);
    if (step == null) {
      parseInvalid = true;
      out.push(null);
      continue;
    }
    s += step;
    out.push(s);
  }
  return { series: out, parseInvalid };
}

function GraphMetricCard(props: {
  title: string;
  kpiDisplay: string;
  showCompare: boolean;
  compareTotalDisplay: string;
  deltaPct: number | null;
  invertDelta?: boolean;
  chart?: ReactNode;
}) {
  const pct = props.deltaPct;
  const pctText = formatDeltaPct(pct);
  const upGood = !props.invertDelta;
  const pctClass =
    pct == null
      ? "text-slate-500"
      : pct > 0
        ? upGood
          ? "text-emerald-700"
          : "text-rose-700"
        : pct < 0
          ? upGood
            ? "text-rose-700"
            : "text-emerald-700"
          : "text-slate-600";

  return (
    <Card className="min-w-0 overflow-hidden shadow-sm">
      <CardHeader className="space-y-1.5 pb-3 pt-5">
        <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {props.title}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
          {props.kpiDisplay}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3 px-4 sm:px-6 pb-5 pt-0">
        {props.chart ? <div className="min-w-0">{props.chart}</div> : null}
        {props.showCompare ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
            <span className={pctClass}>vs comparación: {pctText}</span>
            <span>
              Total comparación:{" "}
              <span className="font-medium text-slate-700">{props.compareTotalDisplay}</span>
            </span>
          </div>
        ) : null}
        <div className={cn("flex justify-end", !props.showCompare && "pt-1")}>
          <Link href="/transactions" className="text-xs font-medium text-[var(--primary)] hover:underline">
            Más información
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminHomeResumen() {
  const initialToday = useMemo(() => defaultSummaryTodayYmd(), []);
  const [intervalPreset, setIntervalPreset] = useState<IntervalPreset>("today");
  const [currentFromYmd, setCurrentFromYmd] = useState(initialToday.fromYmd);
  const [currentToYmd, setCurrentToYmd] = useState(initialToday.toYmd);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [comparatorMode, setComparatorMode] = useState<SummaryComparatorMode>("previous_period");

  const seedCustom = useMemo(
    () => computeCompareYmdRange(initialToday.fromYmd, initialToday.toYmd, "previous_period"),
    [initialToday.fromYmd, initialToday.toYmd],
  );
  const [customFromYmd, setCustomFromYmd] = useState(seedCustom.fromYmd);
  const [customToYmd, setCustomToYmd] = useState(seedCustom.toYmd);

  const defaultCompareFallback = useMemo(
    () => computeCompareYmdRange(currentFromYmd, currentToYmd, "previous_period"),
    [currentFromYmd, currentToYmd],
  );

  const compareYmd = useMemo(() => {
    try {
      return computeCompareYmdRange(currentFromYmd, currentToYmd, comparatorMode, {
        fromYmd: customFromYmd,
        toYmd: customToYmd,
      });
    } catch {
      return defaultCompareFallback;
    }
  }, [comparatorMode, currentFromYmd, currentToYmd, customFromYmd, customToYmd, defaultCompareFallback]);

  const summaryFilters = useMemo(() => {
    const cur = utcYmdRangeToIsoRange(currentFromYmd, currentToYmd);
    const cmp = compareEnabled ? utcYmdRangeToIsoRange(compareYmd.fromYmd, compareYmd.toYmd) : cur;
    return {
      currentFrom: cur.fromIso,
      currentTo: cur.toIso,
      compareFrom: cmp.fromIso,
      compareTo: cmp.toIso,
      currency: SUMMARY_CURRENCY,
    };
  }, [currentFromYmd, currentToYmd, compareEnabled, compareYmd.fromYmd, compareYmd.toYmd]);

  const orderOk =
    currentFromYmd <= currentToYmd &&
    (!compareEnabled ||
      (compareYmd.fromYmd <= compareYmd.toYmd && (comparatorMode !== "custom" || customFromYmd <= customToYmd)));

  const currentSpanDays = utcInclusiveDayCountYmd(currentFromYmd, currentToYmd);
  const compareSpanDays = utcInclusiveDayCountYmd(compareYmd.fromYmd, compareYmd.toYmd);
  const spanOk =
    currentSpanDays !== null &&
    currentSpanDays <= OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC &&
    (!compareEnabled ||
      (compareSpanDays !== null && compareSpanDays <= OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC));

  const summaryRangeValid = orderOk && spanOk;

  const currentDateBounds = useMemo(() => {
    const maxD = OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC - 1;
    return {
      fromMin: addUtcCalendarDaysYmd(currentToYmd, -maxD) ?? undefined,
      fromMax: currentToYmd,
      toMin: currentFromYmd,
      toMax: addUtcCalendarDaysYmd(currentFromYmd, maxD) ?? undefined,
    };
  }, [currentFromYmd, currentToYmd]);

  const customDateBounds = useMemo(() => {
    const maxD = OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC - 1;
    return {
      fromMin: addUtcCalendarDaysYmd(customToYmd, -maxD) ?? undefined,
      fromMax: customToYmd,
      toMin: customFromYmd,
      toMax: addUtcCalendarDaysYmd(customFromYmd, maxD) ?? undefined,
    };
  }, [customFromYmd, customToYmd]);

  const useHourlyBuckets =
    intervalPreset === "today" && (!compareEnabled || compareYmd.fromYmd === compareYmd.toYmd);

  const chartQuery = useQuery<OpsPaymentsSummaryChartResponse>({
    queryKey: ["home-ops-payments-summary-chart", useHourlyBuckets, compareEnabled, summaryFilters],
    queryFn: () =>
      useHourlyBuckets ? fetchOpsPaymentsSummaryHourly(summaryFilters) : fetchOpsPaymentsSummaryDaily(summaryFilters),
    staleTime: 30_000,
    enabled: summaryRangeValid,
  });

  function applyIntervalPreset(p: IntervalPreset) {
    setIntervalPreset(p);
    try {
      if (p === "today") {
        const t = utcTodayYmd();
        setCurrentFromYmd(t);
        setCurrentToYmd(t);
      } else if (p === "last7") {
        const r = utcLastNDaysInclusiveUntilTodayYmd(7);
        setCurrentFromYmd(r.fromYmd);
        setCurrentToYmd(r.toYmd);
      } else if (p === "last30") {
        const r = utcLastNDaysInclusiveUntilTodayYmd(30);
        setCurrentFromYmd(r.fromYmd);
        setCurrentToYmd(r.toYmd);
      }
    } catch {
      /* rango inválido */
    }
  }

  function onCompareModeChange(v: string) {
    if (v === "off") {
      setCompareEnabled(false);
      return;
    }
    setCompareEnabled(true);
    setComparatorMode(v as SummaryComparatorMode);
    if (v === "custom") {
      const d = computeCompareYmdRange(currentFromYmd, currentToYmd, "previous_period");
      setCustomFromYmd(d.fromYmd);
      setCustomToYmd(d.toYmd);
    }
  }

  const cur = chartQuery.data?.current;
  const cmp = chartQuery.data?.compare;
  const isHourlyChart = chartQuery.data?.granularity === "hourly";

  const paymentsTotalCur = cur ? sumSeriesStrings(cur.paymentsTotal) : null;
  const paymentsTotalCmp = cmp ? sumSeriesStrings(cmp.paymentsTotal) : null;
  const grossCur = cur ? sumSeriesStrings(cur.grossVolumeMinor) : null;
  const grossCmp = cmp ? sumSeriesStrings(cmp.grossVolumeMinor) : null;
  const netCur = cur ? sumSeriesStrings(cur.netVolumeMinor) : null;
  const netCmp = cmp ? sumSeriesStrings(cmp.netVolumeMinor) : null;
  const errCur = cur ? sumSeriesStrings(cur.paymentErrorsTotal) : null;
  const errCmp = cmp ? sumSeriesStrings(cmp.paymentErrorsTotal) : null;

  const updatedLabel =
    chartQuery.dataUpdatedAt > 0 ? formatRelativeUpdated(chartQuery.dataUpdatedAt) : "—";

  const compareSingleYmd = compareYmd.fromYmd;

  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">Tu resumen</h2>

      <div className="flex flex-wrap items-center gap-2">
        <div className={cn(pillWrapClass, "pr-8")}>
          <span className="shrink-0 text-slate-600">Intervalo de fechas</span>
          <span className="text-slate-300" aria-hidden>
            |
          </span>
          <select
            id="resumen-intervalo"
            aria-label="Intervalo de fechas"
            className={cn(pillSelectClass, "text-[var(--primary)]")}
            value={intervalPreset}
            onChange={(e) => applyIntervalPreset(e.target.value as IntervalPreset)}
          >
            <option value="today">Hoy</option>
            <option value="last7">Últimos 7 días</option>
            <option value="last30">Últimos 30 días</option>
            <option value="custom">Rango personalizado</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        </div>

        <div className={cn(pillWrapClass, "pr-8", !compareEnabled && "border-dashed border-slate-300")}>
          {!compareEnabled ? <CirclePlus className="size-4 shrink-0 text-slate-400" aria-hidden /> : null}
          <select
            id="resumen-compara"
            aria-label="Comparación"
            className={cn(pillSelectClass, compareEnabled ? "text-slate-800" : "text-slate-600")}
            value={compareEnabled ? comparatorMode : "off"}
            onChange={(e) => onCompareModeChange(e.target.value)}
          >
            <option value="off">Compara</option>
            <option value="previous_period">Periodo anterior</option>
            <option value="previous_month">Mes anterior</option>
            <option value="previous_year">Año anterior</option>
            <option value="custom">Rango personalizado</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        </div>

        <span className="text-xs text-slate-400">UTC · diario</span>
      </div>

      {intervalPreset === "custom" ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="resumen-desde">
              Desde (UTC)
            </label>
            <input
              id="resumen-desde"
              type="date"
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm shadow-sm"
              value={currentFromYmd}
              min={currentDateBounds.fromMin}
              max={currentDateBounds.fromMax}
              onChange={(e) => {
                setIntervalPreset("custom");
                setCurrentFromYmd(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="resumen-hasta">
              Hasta (UTC)
            </label>
            <input
              id="resumen-hasta"
              type="date"
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm shadow-sm"
              value={currentToYmd}
              min={currentDateBounds.toMin}
              max={currentDateBounds.toMax}
              onChange={(e) => {
                setIntervalPreset("custom");
                setCurrentToYmd(e.target.value);
              }}
            />
          </div>
          <p className="text-xs text-slate-500">
            Rango visible: <span className="font-medium text-slate-700">{formatYmdRangeLabel(currentFromYmd, currentToYmd)}</span>
          </p>
        </div>
      ) : null}

      {compareEnabled && comparatorMode === "custom" ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="resumen-cmp-desde">
              Comparación desde (UTC)
            </label>
            <input
              id="resumen-cmp-desde"
              type="date"
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm shadow-sm"
              value={customFromYmd}
              min={customDateBounds.fromMin}
              max={customDateBounds.fromMax}
              onChange={(e) => setCustomFromYmd(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="resumen-cmp-hasta">
              Comparación hasta (UTC)
            </label>
            <input
              id="resumen-cmp-hasta"
              type="date"
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm shadow-sm"
              value={customToYmd}
              min={customDateBounds.toMin}
              max={customDateBounds.toMax}
              onChange={(e) => setCustomToYmd(e.target.value)}
            />
          </div>
        </div>
      ) : null}

      {!orderOk ? (
        <p className="text-sm text-amber-800">Revisa los rangos de fechas (desde ≤ hasta, UTC).</p>
      ) : !spanOk ? (
        <p className="text-sm text-amber-800">
          Cada ventana (actual y comparación) admite como máximo {OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC} días calendario UTC
          inclusive. Acorta el intervalo o el periodo custom.
        </p>
      ) : chartQuery.isError ? (
        <p className="text-sm text-rose-700">{(chartQuery.error as Error).message}</p>
      ) : chartQuery.isLoading || !cur || !cmp ? (
        <p className="text-sm text-slate-500">Cargando series…</p>
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Última actualización: <span className="font-medium text-slate-700">{updatedLabel}</span>
          </p>
          {!isHourlyChart ? (
            <p className="text-xs text-slate-500">
              El gráfico horario (mismo estilo que el volumen en el panel principal) está disponible con el intervalo
              «Hoy» y comparación en un solo día UTC, o sin comparación.
            </p>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {(() => {
              const n = Math.min(cur.paymentsTotal.length, cmp.paymentsTotal.length, cur.labels.length);
              const take = (arr: string[]) => arr.slice(0, n);

              const payCur = take(cur.paymentsTotal);
              const payCmp = take(cmp.paymentsTotal);
              const grossCurS = take(cur.grossVolumeMinor);
              const grossCmpS = take(cmp.grossVolumeMinor);
              const netCurS = take(cur.netVolumeMinor);
              const netCmpS = take(cmp.netVolumeMinor);
              const errCurS = take(cur.paymentErrorsTotal);
              const errCmpS = take(cmp.paymentErrorsTotal);

              const payToday = incrementalToCumulativeToday(payCur, currentFromYmd);
              const payCompare = incrementalToCumulativeCompare(payCmp);
              const grossToday = incrementalToCumulativeToday(grossCurS, currentFromYmd);
              const grossCompare = incrementalToCumulativeCompare(grossCmpS);
              const netToday = incrementalToCumulativeToday(netCurS, currentFromYmd);
              const netCompare = incrementalToCumulativeCompare(netCmpS);
              const errToday = incrementalToCumulativeToday(errCurS, currentFromYmd);
              const errCompare = incrementalToCumulativeCompare(errCmpS);

              const currency = chartQuery.data?.currency ?? SUMMARY_CURRENCY;

              const mkChart = (
                today: { series: (bigint | null)[]; parseInvalid: boolean },
                compare: { series: (bigint | null)[]; parseInvalid: boolean },
                valueUnit: "count" | "currency_minor",
                metricLabel: string,
              ) =>
                isHourlyChart && n >= 24 ? (
                  <OpsCumulativeHourlyChart
                    todayCumulative={today.series}
                    compareCumulative={compare.series}
                    valueUnit={valueUnit}
                    currency={currency}
                    metricLabel={metricLabel}
                    todayUtcYmd={currentFromYmd}
                    compareUtcYmd={compareSingleYmd}
                    showCompare={compareEnabled}
                    seriesParseInvalid={today.parseInvalid || compare.parseInvalid}
                  />
                ) : undefined;

              return (
                <>
                  <GraphMetricCard
                    title="Payments"
                    kpiDisplay={formatBigIntCount(paymentsTotalCur ?? 0n)}
                    showCompare={compareEnabled}
                    compareTotalDisplay={formatBigIntCount(paymentsTotalCmp ?? 0n)}
                    deltaPct={deltaPct(paymentsTotalCur ?? 0n, paymentsTotalCmp ?? 0n)}
                    chart={mkChart(payToday, payCompare, "count", "Payments")}
                  />
                  <GraphMetricCard
                    title="Volumen bruto"
                    kpiDisplay={formatAmountMinor(grossCur ?? 0n, SUMMARY_CURRENCY)}
                    showCompare={compareEnabled}
                    compareTotalDisplay={formatAmountMinor(grossCmp ?? 0n, SUMMARY_CURRENCY)}
                    deltaPct={deltaPct(grossCur ?? 0n, grossCmp ?? 0n)}
                    chart={mkChart(grossToday, grossCompare, "currency_minor", "Volumen bruto")}
                  />
                  <GraphMetricCard
                    title="Volumen neto"
                    kpiDisplay={formatAmountMinor(netCur ?? 0n, SUMMARY_CURRENCY)}
                    showCompare={compareEnabled}
                    compareTotalDisplay={formatAmountMinor(netCmp ?? 0n, SUMMARY_CURRENCY)}
                    deltaPct={deltaPct(netCur ?? 0n, netCmp ?? 0n)}
                    chart={mkChart(netToday, netCompare, "currency_minor", "Volumen neto")}
                  />
                  <GraphMetricCard
                    title="Errores en los pagos"
                    kpiDisplay={formatBigIntCount(errCur ?? 0n)}
                    showCompare={compareEnabled}
                    compareTotalDisplay={formatBigIntCount(errCmp ?? 0n)}
                    deltaPct={deltaPct(errCur ?? 0n, errCmp ?? 0n)}
                    invertDelta
                    chart={mkChart(errToday, errCompare, "count", "Errores en los pagos")}
                  />
                </>
              );
            })()}
          </div>
        </>
      )}
    </section>
  );
}
