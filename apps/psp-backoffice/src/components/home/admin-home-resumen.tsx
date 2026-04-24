"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { OpsPaymentsSummaryDailyResponse } from "@/lib/api/contracts";
import { fetchOpsPaymentsSummaryDaily } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { formatAmountMinor } from "@/lib/ops-transaction-display";
import {
  addUtcCalendarDaysYmd,
  computeCompareYmdRange,
  defaultSummaryCurrentRangeYmd,
  OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC,
  type SummaryComparatorMode,
  utcInclusiveDayCountYmd,
  utcYmdRangeToIsoRange,
} from "./admin-summary-range";

const SUMMARY_CURRENCY = "EUR";
const CHART_W = 320;
const CHART_H = 100;
const PAD = { t: 8, r: 8, b: 22, l: 8 };

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
  emptyLabel?: string;
}) {
  const { a: c0, b: p0 } = alignSeriesPair(props.current, props.compare);
  const labels = props.labels.slice(0, c0.length);
  const cur = stringsToNumsForChart(c0);
  const cmp = stringsToNumsForChart(p0);
  const all = [...cur, ...cmp];
  const hasAny = all.some((v) => v !== 0);
  if (!hasAny && cur.length > 0) {
    return (
      <div
        className="flex h-[100px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500"
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
  const dCmp = toPts(cmp);
  const xTickIdx =
    cur.length <= 1
      ? [0]
      : [0, Math.floor((cur.length - 1) / 2), cur.length - 1].filter((i, idx, arr) => arr.indexOf(i) === idx);

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="h-auto w-full max-w-full text-slate-400"
      role="img"
      aria-label="Serie diaria: periodo actual y comparación"
    >
      <rect width={CHART_W} height={CHART_H} fill="transparent" />
      {dCmp ? (
        <polyline
          fill="none"
          stroke="#94a3b8"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="4 3"
          points={dCmp}
        />
      ) : null}
      {dCur ? (
        <polyline
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={dCur}
        />
      ) : null}
      {xTickIdx.map((i) => {
        const x = PAD.l + (cur.length === 1 ? innerW / 2 : (i / (cur.length - 1)) * innerW);
        const lab = labels[i] ? shortUtcLabel(labels[i]!) : "";
        return (
          <text key={i} x={x} y={CHART_H - 4} textAnchor="middle" className="fill-slate-400 text-[9px]">
            {lab}
          </text>
        );
      })}
    </svg>
  );
}

function GraphMetricCard(props: {
  title: string;
  kpiDisplay: string;
  currentSeries: string[];
  compareSeries: string[];
  dayLabels: string[];
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
    <Card className="overflow-hidden">
      <CardHeader className="space-y-1 pb-2">
        <CardDescription className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {props.title}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
          {props.kpiDisplay}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <SummarySparkline
          current={props.currentSeries}
          compare={props.compareSeries}
          labels={props.dayLabels}
          emptyLabel={props.emptyHint}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
          <span className={pctClass}>vs comparación: {pctText}</span>
          <span>
            Total comparación:{" "}
            <span className="font-medium text-slate-700">{props.compareTotalDisplay}</span>
          </span>
        </div>
        <div className="flex justify-end">
          <Link href="/transactions" className="text-xs font-medium text-[var(--primary)] hover:underline">
            Más información
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminHomeResumen() {
  const initial = useMemo(() => defaultSummaryCurrentRangeYmd(), []);
  const [currentFromYmd, setCurrentFromYmd] = useState(initial.fromYmd);
  const [currentToYmd, setCurrentToYmd] = useState(initial.toYmd);
  const [comparatorMode, setComparatorMode] = useState<SummaryComparatorMode>("previous_period");
  const defaultCustom = useMemo(
    () => computeCompareYmdRange(initial.fromYmd, initial.toYmd, "previous_period"),
    [initial.fromYmd, initial.toYmd],
  );
  const [customFromYmd, setCustomFromYmd] = useState(defaultCustom.fromYmd);
  const [customToYmd, setCustomToYmd] = useState(defaultCustom.toYmd);

  const compareYmd = useMemo(() => {
    try {
      return computeCompareYmdRange(currentFromYmd, currentToYmd, comparatorMode, {
        fromYmd: customFromYmd,
        toYmd: customToYmd,
      });
    } catch {
      return defaultCustom;
    }
  }, [comparatorMode, currentFromYmd, currentToYmd, customFromYmd, customToYmd, defaultCustom]);

  const summaryFilters = useMemo(() => {
    const cur = utcYmdRangeToIsoRange(currentFromYmd, currentToYmd);
    const cmp = utcYmdRangeToIsoRange(compareYmd.fromYmd, compareYmd.toYmd);
    return {
      currentFrom: cur.fromIso,
      currentTo: cur.toIso,
      compareFrom: cmp.fromIso,
      compareTo: cmp.toIso,
      currency: SUMMARY_CURRENCY,
    };
  }, [currentFromYmd, currentToYmd, compareYmd.fromYmd, compareYmd.toYmd]);

  const orderOk =
    currentFromYmd <= currentToYmd &&
    compareYmd.fromYmd <= compareYmd.toYmd &&
    (comparatorMode !== "custom" || customFromYmd <= customToYmd);

  const currentSpanDays = utcInclusiveDayCountYmd(currentFromYmd, currentToYmd);
  const compareSpanDays = utcInclusiveDayCountYmd(compareYmd.fromYmd, compareYmd.toYmd);
  const spanOk =
    currentSpanDays !== null &&
    compareSpanDays !== null &&
    currentSpanDays <= OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC &&
    compareSpanDays <= OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC;

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

  const dailyQuery = useQuery<OpsPaymentsSummaryDailyResponse>({
    queryKey: ["home-ops-payments-summary-daily", summaryFilters],
    queryFn: () => fetchOpsPaymentsSummaryDaily(summaryFilters),
    staleTime: 30_000,
    enabled: summaryRangeValid,
  });

  const cur = dailyQuery.data?.current;
  const cmp = dailyQuery.data?.compare;

  const paymentsTotalCur = cur ? sumSeriesStrings(cur.paymentsTotal) : null;
  const paymentsTotalCmp = cmp ? sumSeriesStrings(cmp.paymentsTotal) : null;
  const grossCur = cur ? sumSeriesStrings(cur.grossVolumeMinor) : null;
  const grossCmp = cmp ? sumSeriesStrings(cmp.grossVolumeMinor) : null;
  const netCur = cur ? sumSeriesStrings(cur.netVolumeMinor) : null;
  const netCmp = cmp ? sumSeriesStrings(cmp.netVolumeMinor) : null;
  const errCur = cur ? sumSeriesStrings(cur.paymentErrorsTotal) : null;
  const errCmp = cmp ? sumSeriesStrings(cmp.paymentErrorsTotal) : null;

  const updatedLabel =
    dailyQuery.dataUpdatedAt > 0 ? formatRelativeUpdated(dailyQuery.dataUpdatedAt) : "—";

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Tu resumen</h2>
        <p className="text-sm text-slate-600">
          Intervalo: <span className="font-medium text-slate-800">{formatYmdRangeLabel(currentFromYmd, currentToYmd)}</span>{" "}
          <span className="text-slate-400">·</span> UTC
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="flex flex-wrap items-end gap-2">
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
                  onChange={(e) => setCurrentFromYmd(e.target.value)}
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
                  onChange={(e) => setCurrentToYmd(e.target.value)}
                />
              </div>
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="resumen-gran">
                Granularidad
              </label>
              <Select id="resumen-gran" value="daily" disabled className="opacity-80">
                <option value="daily">Diario</option>
              </Select>
            </div>
            <div className="min-w-[220px] flex-1 lg:max-w-xs">
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="resumen-comparador">
                Compara
              </label>
              <Select
                id="resumen-comparador"
                value={comparatorMode}
                onChange={(e) => setComparatorMode(e.target.value as SummaryComparatorMode)}
              >
                <option value="previous_period">Periodo anterior</option>
                <option value="previous_month">Mes anterior</option>
                <option value="previous_year">Año anterior</option>
                <option value="custom">Custom</option>
              </Select>
            </div>
          </div>

          {comparatorMode === "custom" ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50/60 p-3">
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
              Cada ventana (actual y comparación) admite como máximo {OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC} días
              calendario UTC inclusive. Acorta el intervalo o el periodo custom.
            </p>
          ) : dailyQuery.isError ? (
            <p className="text-sm text-rose-700">{(dailyQuery.error as Error).message}</p>
          ) : dailyQuery.isLoading || !cur || !cmp ? (
            <p className="text-sm text-slate-500">Cargando series…</p>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Última actualización: <span className="font-medium text-slate-700">{updatedLabel}</span>
              </p>
              <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {(() => {
                  const n = Math.min(
                    cur.paymentsTotal.length,
                    cmp.paymentsTotal.length,
                    cur.labels.length,
                  );
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
                        compareTotalDisplay={formatAmountMinor(grossCmp ?? 0n, SUMMARY_CURRENCY)}
                        deltaPct={deltaPct(grossCur ?? 0n, grossCmp ?? 0n)}
                      />
                      <GraphMetricCard
                        title="Volumen neto"
                        kpiDisplay={formatAmountMinor(netCur ?? 0n, SUMMARY_CURRENCY)}
                        currentSeries={take(cur.netVolumeMinor)}
                        compareSeries={take(cmp.netVolumeMinor)}
                        dayLabels={dayLabels}
                        compareTotalDisplay={formatAmountMinor(netCmp ?? 0n, SUMMARY_CURRENCY)}
                        deltaPct={deltaPct(netCur ?? 0n, netCmp ?? 0n)}
                      />
                      <GraphMetricCard
                        title="Errores en los pagos"
                        kpiDisplay={formatBigIntCount(errCur ?? 0n)}
                        currentSeries={take(cur.paymentErrorsTotal)}
                        compareSeries={take(cmp.paymentErrorsTotal)}
                        dayLabels={dayLabels}
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
        </CardContent>
      </Card>
    </section>
  );
}
