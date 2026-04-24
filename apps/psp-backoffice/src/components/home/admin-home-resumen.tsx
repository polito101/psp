"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronDown, CirclePlus } from "lucide-react";
import type { OpsPaymentsSummaryChartResponse } from "@/lib/api/contracts";
import { fetchOpsPaymentsSummaryDaily, fetchOpsPaymentsSummaryHourly } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAmountMinor } from "@/lib/ops-transaction-display";
import { cn } from "@/lib/utils";
import { ResumenHourlyLineChart } from "./resumen-hourly-line-chart";
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

function stringsToNumsForChart(arr: string[]): number[] {
  return arr.map((s) => {
    const b = parseBig(s);
    if (b > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    if (b < BigInt(Number.MIN_SAFE_INTEGER)) return Number.MIN_SAFE_INTEGER;
    return Number(b);
  });
}

function shortUtcLabel(ymd: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(ymdToUtcDate(ymd));
}

function alignSeriesPair(a: string[], b: string[]): { a: string[]; b: string[] } {
  const n = Math.min(a.length, b.length);
  return { a: a.slice(0, n), b: b.slice(0, n) };
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

function SummarySparkline(props: {
  current: string[];
  compare: string[];
  labels: string[];
  showCompare?: boolean;
  /** `hour`: 24 buckets, mismo layout que el gráfico de volumen (acumulado + rejilla). */
  xAxisMode?: "day" | "hour";
  utcHourDayCurrent?: string;
  emptyLabel?: string;
}) {
  const showCompare = props.showCompare ?? true;
  const isHour = props.xAxisMode === "hour";
  const CHART_W = 400;
  const CHART_H = 120;
  const PAD = { t: 10, r: 10, b: 12, l: 10 };
  const emptyMinH = 120;

  const { a: c0, b: p0 } = alignSeriesPair(props.current, props.compare);
  const cur = stringsToNumsForChart(c0);
  const cmp = stringsToNumsForChart(p0);
  if (isHour && c0.length === 24 && props.utcHourDayCurrent) {
    return (
      <ResumenHourlyLineChart
        incrementalCurrent={c0}
        incrementalCompare={p0}
        showCompare={showCompare}
        utcYmdCurrent={props.utcHourDayCurrent}
      />
    );
  }
  if (cur.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500"
        style={{ minHeight: emptyMinH }}
        role="img"
        aria-label={props.emptyLabel ?? "Sin datos"}
      >
        {props.emptyLabel ?? "No hay datos"}
      </div>
    );
  }
  const all = showCompare ? [...cur, ...cmp] : [...cur];
  const hasAny = all.some((v) => v !== 0);
  if (!hasAny && cur.length > 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500"
        style={{ minHeight: emptyMinH }}
        role="img"
        aria-label={props.emptyLabel ?? "Sin datos en el intervalo"}
      >
        {props.emptyLabel ?? "No hay datos"}
      </div>
    );
  }
  const minV = Math.min(...all, 0);
  const maxV = Math.max(...all, 0);
  const span = maxV - minV || 1;
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const toPts = (values: number[]) =>
    values
      .map((v, i) => {
        const x =
          values.length === 1 ? PAD.l + innerW / 2 : PAD.l + (i / (values.length - 1)) * innerW;
        const y = PAD.t + innerH - ((v - minV) / span) * innerH;
        return `${x},${y}`;
      })
      .join(" ");

  const dCur = toPts(cur);
  const dCmp = showCompare ? toPts(cmp) : "";

  const yAt = (v: number) => PAD.t + innerH - ((v - minV) / span) * innerH;
  const xMid = PAD.l + innerW / 2;

  const ariaSeries = isHour ? "Serie horaria UTC" : "Serie diaria";

  if (cur.length === 1 && hasAny) {
    return (
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="h-auto w-full max-w-full text-slate-400"
        role="img"
        aria-label={showCompare ? `${ariaSeries}: actual y comparación` : ariaSeries}
      >
        <rect width={CHART_W} height={CHART_H} fill="white" rx={8} stroke="#e2e8f0" strokeWidth={1} />
        {showCompare && cmp.length >= 1 ? (
          <circle
            cx={xMid}
            cy={yAt(cmp[0]!)}
            r={4}
            fill="white"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeDasharray="3 2"
          />
        ) : null}
        <circle cx={xMid} cy={yAt(cur[0]!)} r={5} fill="var(--primary)" />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="h-auto w-full max-w-full text-slate-400"
      role="img"
      aria-label={showCompare ? `${ariaSeries}: periodo actual y comparación` : ariaSeries}
    >
      <rect width={CHART_W} height={CHART_H} fill="white" rx={8} stroke="#e2e8f0" strokeWidth={1} />
      {showCompare && dCmp ? (
        <polyline
          fill="none"
          stroke="#94a3b8"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="5 4"
          points={dCmp}
        />
      ) : null}
      {dCur ? (
        <polyline
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={dCur}
        />
      ) : null}
    </svg>
  );
}

function GraphMetricCard(props: {
  title: string;
  kpiDisplay: string;
  currentSeries: string[];
  compareSeries: string[];
  dayLabels: string[];
  showCompare: boolean;
  xAxisMode?: "day" | "hour";
  utcHourDayCurrent?: string;
  compareTotalDisplay: string;
  deltaPct: number | null;
  invertDelta?: boolean;
  emptyHint?: string;
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
    <Card className="overflow-hidden shadow-sm">
      <CardHeader className="space-y-1.5 pb-3 pt-5">
        <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {props.title}
        </CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
          {props.kpiDisplay}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-6 pb-5 pt-0">
        <SummarySparkline
          current={props.currentSeries}
          compare={props.compareSeries}
          labels={props.dayLabels}
          showCompare={props.showCompare}
          xAxisMode={props.xAxisMode}
          utcHourDayCurrent={props.utcHourDayCurrent}
          emptyLabel={props.emptyHint}
        />
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
  const chartXAxisMode = chartQuery.data?.granularity === "hourly" ? "hour" : "day";

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
          <div className="grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {(() => {
              const n = Math.min(cur.paymentsTotal.length, cmp.paymentsTotal.length, cur.labels.length);
              const dayLabels = cur.labels.slice(0, n);
              const take = (arr: string[]) => arr.slice(0, n);
              return (
                <>
                  <GraphMetricCard
                    title="Payments"
                    kpiDisplay={formatBigIntCount(paymentsTotalCur ?? 0n)}
                    currentSeries={take(cur.paymentsTotal)}
                    compareSeries={take(cmp.paymentsTotal)}
                    dayLabels={dayLabels}
                    showCompare={compareEnabled}
                    xAxisMode={chartXAxisMode}
                    utcHourDayCurrent={currentFromYmd}
                    compareTotalDisplay={formatBigIntCount(paymentsTotalCmp ?? 0n)}
                    deltaPct={deltaPct(paymentsTotalCur ?? 0n, paymentsTotalCmp ?? 0n)}
                    emptyHint="No hay datos"
                  />
                  <GraphMetricCard
                    title="Volumen bruto"
                    kpiDisplay={formatAmountMinor(grossCur ?? 0n, SUMMARY_CURRENCY)}
                    currentSeries={take(cur.grossVolumeMinor)}
                    compareSeries={take(cmp.grossVolumeMinor)}
                    dayLabels={dayLabels}
                    showCompare={compareEnabled}
                    xAxisMode={chartXAxisMode}
                    utcHourDayCurrent={currentFromYmd}
                    compareTotalDisplay={formatAmountMinor(grossCmp ?? 0n, SUMMARY_CURRENCY)}
                    deltaPct={deltaPct(grossCur ?? 0n, grossCmp ?? 0n)}
                  />
                  <GraphMetricCard
                    title="Volumen neto"
                    kpiDisplay={formatAmountMinor(netCur ?? 0n, SUMMARY_CURRENCY)}
                    currentSeries={take(cur.netVolumeMinor)}
                    compareSeries={take(cmp.netVolumeMinor)}
                    dayLabels={dayLabels}
                    showCompare={compareEnabled}
                    xAxisMode={chartXAxisMode}
                    utcHourDayCurrent={currentFromYmd}
                    compareTotalDisplay={formatAmountMinor(netCmp ?? 0n, SUMMARY_CURRENCY)}
                    deltaPct={deltaPct(netCur ?? 0n, netCmp ?? 0n)}
                  />
                  <GraphMetricCard
                    title="Errores en los pagos"
                    kpiDisplay={formatBigIntCount(errCur ?? 0n)}
                    currentSeries={take(cur.paymentErrorsTotal)}
                    compareSeries={take(cmp.paymentErrorsTotal)}
                    dayLabels={dayLabels}
                    showCompare={compareEnabled}
                    xAxisMode={chartXAxisMode}
                    utcHourDayCurrent={currentFromYmd}
                    compareTotalDisplay={formatBigIntCount(errCmp ?? 0n)}
                    deltaPct={deltaPct(errCur ?? 0n, errCmp ?? 0n)}
                    invertDelta
                    emptyHint="No hay datos"
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
