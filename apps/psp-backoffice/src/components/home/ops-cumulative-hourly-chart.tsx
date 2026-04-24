"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OpsVolumeHourlyResponse } from "@/lib/api/contracts";
import { amountMinorToBigInt, formatAmountMinor } from "@/lib/ops-transaction-display";
import { parseUtcYmdParts } from "./utc-compare-date";

export const OPS_CHART_PAD = { t: 16, r: 12, b: 18, l: 48 };
export const OPS_CHART_MIN_W = 280;
export const OPS_CHART_ASPECT = 0.34;

/**
 * Aproxima num/den en coma flotante sin hacer `Number(num)` cuando el acumulado puede
 * superar `MAX_SAFE_INTEGER` (evita distorsión del trazado SVG).
 */
export function bigintRatioToNumber(num: bigint, den: bigint): number {
  if (den === 0n) return 0;
  if (num === 0n) return 0;
  let scale = 1_000_000_000n;
  for (let i = 0; i < 48; i++) {
    const q = (num * scale) / den;
    if (q !== 0n) return Number(q) / Number(scale);
    scale *= 10n;
  }
  return 0;
}

export function buildCumulativeHourlyPath(
  series: (bigint | null)[],
  yMax: bigint,
  w: number,
  h: number,
  pad = OPS_CHART_PAD,
): { d: string; lastIndex: number } {
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const toX = (i: number) => pad.l + (i / 23) * innerW;
  const toY = (v: bigint) =>
    pad.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(v, yMax) * innerH);
  let d = "";
  let penUp = true;
  let lastIndex = -1;
  for (let i = 0; i < 24; i++) {
    const v = series[i];
    if (v == null) {
      penUp = true;
      continue;
    }
    const x = toX(i);
    const y = toY(v);
    d += penUp ? `M ${x} ${y}` : ` L ${x} ${y}`;
    penUp = false;
    lastIndex = i;
  }
  return { d, lastIndex };
}

function formatAxisMinorUnits(n: bigint): string {
  const abs = n < 0n ? -n : n;
  if (abs >= 1_000_000n) {
    const whole = abs / 1_000_000n;
    const frac = (abs % 1_000_000n) / 100_000n;
    return frac === 0n ? `${whole}M` : `${whole}.${frac}M`;
  }
  if (abs >= 1000n) {
    const whole = abs / 1000n;
    const frac = (abs % 1000n) / 100n;
    return frac === 0n ? `${whole}k` : `${whole}.${frac}k`;
  }
  return abs.toString();
}

/** Volumen bruto del intervalo [h,h) a partir de serie acumulada (minor). */
function hourlyFromCumulative(cumulative: (bigint | null)[]): (bigint | null)[] {
  return cumulative.map((v, h) => {
    if (v == null) return null;
    if (h === 0) return v;
    const prev = cumulative[h - 1];
    if (prev == null) return null;
    return v - prev;
  });
}

function hourlyTodayFromCumulative(
  cumulative: (bigint | null)[],
  maxHour: number,
): (bigint | null)[] {
  const out: (bigint | null)[] = Array(24).fill(null);
  if (maxHour < 0) return out;
  for (let h = 0; h <= maxHour; h++) {
    const cur = cumulative[h];
    if (cur == null) continue;
    if (h === 0) {
      out[h] = cur;
      continue;
    }
    const prev = cumulative[h - 1];
    if (prev == null) {
      out[h] = null;
      continue;
    }
    out[h] = cur - prev;
  }
  return out;
}

function utcCalendarDates(): { y: number; m: number; d: number } {
  const now = new Date();
  return {
    y: now.getUTCFullYear(),
    m: now.getUTCMonth(),
    d: now.getUTCDate(),
  };
}

function formatUtcBucketLabel(y: number, m: number, d: number, hour: number): string {
  const dt = new Date(Date.UTC(y, m, d, hour, 0, 0, 0));
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(dt);
}

function hourOverHourPct(todayMinor: bigint, yesterdayMinor: bigint): number | null {
  if (yesterdayMinor === 0n) {
    if (todayMinor === 0n) return 0;
    return null;
  }
  return Number(((todayMinor - yesterdayMinor) * 10000n) / yesterdayMinor) / 100;
}

function formatPct(p: number | null): { text: string; tone: "up" | "down" | "flat" | "na" } {
  if (p == null) return { text: "—", tone: "na" };
  if (p === 0) return { text: "0 %", tone: "flat" };
  const rounded = Math.abs(p) >= 100 ? Math.round(p) : Math.round(p * 10) / 10;
  const num = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    signDisplay: "exceptZero",
  }).format(rounded);
  const text = `${num} %`;
  if (rounded > 0) return { text, tone: "up" };
  if (rounded < 0) return { text, tone: "down" };
  return { text, tone: "flat" };
}

function formatSeriesValue(
  valueUnit: OpsVolumeHourlyResponse["valueUnit"],
  raw: string | bigint | null | undefined,
  currency: string,
): string {
  if (raw == null) return "—";
  if (valueUnit === "count") {
    const b = amountMinorToBigInt(raw);
    if (b == null) return "—";
    if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < BigInt(Number.MIN_SAFE_INTEGER)) {
      return b.toString();
    }
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(Number(b));
  }
  return formatAmountMinor(raw, currency);
}

export type OpsCumulativeHourlyChartProps = {
  todayCumulative: (bigint | null)[];
  compareCumulative: (bigint | null)[];
  valueUnit: OpsVolumeHourlyResponse["valueUnit"];
  currency: string;
  metricLabel: string;
  todayUtcYmd: string;
  compareUtcYmd: string;
  showCompare?: boolean;
  seriesParseInvalid?: boolean;
  className?: string;
};

/**
 * SVG + interacción del gráfico de acumulado horario UTC (misma geometría que el volumen en home).
 */
export function OpsCumulativeHourlyChart({
  todayCumulative: parsedToday,
  compareCumulative: parsedCompare,
  valueUnit,
  currency,
  metricLabel,
  todayUtcYmd,
  compareUtcYmd,
  showCompare = true,
  seriesParseInvalid = false,
  className,
}: OpsCumulativeHourlyChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(OPS_CHART_MIN_W);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setChartW(Math.max(OPS_CHART_MIN_W, Math.floor(cr.width)));
    });
    ro.observe(el);
    setChartW(Math.max(OPS_CHART_MIN_W, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const chartH = Math.max(200, Math.round(chartW * OPS_CHART_ASPECT));
  const pad = OPS_CHART_PAD;

  const maxTodayHour = useMemo(() => {
    let m = -1;
    parsedToday.forEach((v, i) => {
      if (v != null) m = i;
    });
    return m;
  }, [parsedToday]);

  const compareDayHourly = useMemo(() => hourlyFromCumulative(parsedCompare), [parsedCompare]);

  const todayHourly = useMemo(
    () => hourlyTodayFromCumulative(parsedToday, maxTodayHour),
    [parsedToday, maxTodayHour],
  );

  const yMax = useMemo(() => {
    let tMax = 0n;
    for (const v of parsedToday) {
      if (v != null && v > tMax) tMax = v;
    }
    if (!showCompare) return tMax > 0n ? tMax : 1n;
    const cLast = parsedCompare[23] ?? 0n;
    const m = cLast > tMax ? cLast : tMax;
    return m > 0n ? m : 1n;
  }, [parsedToday, parsedCompare, showCompare]);

  const comparePath = useMemo(
    () =>
      showCompare
        ? buildCumulativeHourlyPath(parsedCompare, yMax, chartW, chartH, pad)
        : { d: "", lastIndex: -1 },
    [parsedCompare, yMax, chartW, chartH, showCompare, pad],
  );

  const todayPath = useMemo(
    () => buildCumulativeHourlyPath(parsedToday, yMax, chartW, chartH, pad),
    [parsedToday, yMax, chartW, chartH, pad],
  );

  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => (yMax * BigInt(i)) / BigInt(steps));
  }, [yMax]);

  const innerH = chartH - pad.t - pad.b;
  const innerW = chartW - pad.l - pad.r;

  const { y: cy, m: cm, d: cd } = utcCalendarDates();
  const todayParts = parseUtcYmdParts(todayUtcYmd) ?? { y: cy, m: cm, d: cd };
  const compareParts = parseUtcYmdParts(compareUtcYmd) ?? todayParts;

  const [hoverHour, setHoverHour] = useState<number | null>(null);
  const [pointerXSvg, setPointerXSvg] = useState<number | null>(null);
  const [tooltipOffset, setTooltipOffset] = useState<{ left: number; top: number } | null>(null);
  const chartInteractRef = useRef<HTMLDivElement>(null);

  const toHourFromClientX = useCallback(
    (clientX: number): number | null => {
      const svg = wrapRef.current?.querySelector("[data-chart-svg]") as SVGSVGElement | null;
      if (!svg?.viewBox?.baseVal) return null;
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const xSvg = ((clientX - rect.left) / rect.width) * vb.width;
      if (xSvg < pad.l || xSvg > chartW - pad.r) return null;
      const t = (xSvg - pad.l) / innerW;
      const raw = Math.round(t * 23);
      return Math.max(0, Math.min(23, raw));
    },
    [chartW, innerW, pad.l, pad.r],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const h = toHourFromClientX(e.clientX);
      if (h == null) {
        setHoverHour(null);
        setPointerXSvg(null);
        setTooltipOffset(null);
        return;
      }
      const clamped = maxTodayHour >= 0 ? Math.min(h, maxTodayHour) : h;
      setHoverHour(clamped);
      const xSvg = pad.l + (clamped / 23) * innerW;
      setPointerXSvg(xSvg);

      const box = chartInteractRef.current?.getBoundingClientRect();
      if (box) {
        const x = e.clientX - box.left;
        const tipW = 220;
        const p = 8;
        const flip = x > box.width * 0.52;
        const left = flip ? Math.max(p, x - tipW - p) : Math.min(x + p, box.width - tipW - p);
        setTooltipOffset({ left, top: p });
      }
    },
    [toHourFromClientX, maxTodayHour, innerW, pad.l],
  );

  const onPointerLeave = useCallback(() => {
    setHoverHour(null);
    setPointerXSvg(null);
    setTooltipOffset(null);
  }, []);

  const toY = (v: bigint) =>
    pad.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(v, yMax) * innerH);

  const hoverCompareCum =
    showCompare && hoverHour != null ? parsedCompare[hoverHour] ?? null : null;
  const hoverTodayCum = hoverHour != null ? parsedToday[hoverHour] ?? null : null;

  const hoverCompareHourly =
    showCompare && hoverHour != null ? compareDayHourly[hoverHour] : null;
  const hoverTodayHourly = hoverHour != null ? todayHourly[hoverHour] : null;

  const pct =
    showCompare && hoverTodayHourly != null && hoverCompareHourly != null
      ? hourOverHourPct(hoverTodayHourly, hoverCompareHourly)
      : null;
  const pctFmt = formatPct(pct);

  return (
    <div ref={wrapRef} className={className ?? "w-full min-w-0"}>
      {seriesParseInvalid ? (
        <div
          className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="alert"
        >
          Los importes en unidades menores del payload no son enteros decimales válidos; el gráfico puede
          aparecer incompleto.
        </div>
      ) : null}

      <div ref={chartInteractRef} className="relative">
        <svg
          data-chart-svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="h-auto w-full touch-none select-none text-slate-600"
          role="img"
          aria-label="Serie acumulada hoy frente al día de comparación por hora UTC"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onPointerDown={onPointerMove}
        >
          <rect x="0" y="0" width={chartW} height={chartH} fill="white" rx="8" />
          {yTicks.map((tick) => {
            const y =
              pad.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(tick, yMax) * innerH);
            return (
              <g key={tick.toString()}>
                <line
                  x1={pad.l}
                  x2={chartW - pad.r}
                  y1={y}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
                <text
                  x={pad.l - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px]"
                >
                  {formatAxisMinorUnits(tick)}
                </text>
              </g>
            );
          })}
          {showCompare && comparePath.d ? (
            <path
              d={comparePath.d}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="5 4"
            />
          ) : null}
          {todayPath.d ? (
            <path
              d={todayPath.d}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {hoverHour != null && pointerXSvg != null && maxTodayHour >= 0 ? (
            <line
              x1={pointerXSvg}
              x2={pointerXSvg}
              y1={pad.t}
              y2={pad.t + innerH}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          ) : null}
          {showCompare &&
          hoverHour != null &&
          hoverCompareCum != null &&
          pointerXSvg != null &&
          maxTodayHour >= 0 ? (
            <circle
              cx={pointerXSvg}
              cy={toY(hoverCompareCum)}
              r={5}
              fill="#94a3b8"
              stroke="#fff"
              strokeWidth={2}
              pointerEvents="none"
            />
          ) : null}
          {hoverHour != null &&
          hoverTodayCum != null &&
          pointerXSvg != null &&
          maxTodayHour >= 0 ? (
            <circle
              cx={pointerXSvg}
              cy={toY(hoverTodayCum)}
              r={5}
              fill="var(--primary)"
              stroke="#fff"
              strokeWidth={2}
              pointerEvents="none"
            />
          ) : null}
          {todayPath.lastIndex >= 0 && hoverHour == null ? (
            (() => {
              const v = parsedToday[todayPath.lastIndex];
              if (v == null) return null;
              const x = pad.l + (todayPath.lastIndex / 23) * innerW;
              const y = toY(v);
              return (
                <circle cx={x} cy={y} r={4} fill="var(--primary)" stroke="#fff" strokeWidth={2} />
              );
            })()
          ) : null}
        </svg>

        {hoverHour != null &&
        hoverTodayHourly != null &&
        (showCompare ? hoverCompareHourly != null : true) &&
        pointerXSvg != null &&
        tooltipOffset != null &&
        maxTodayHour >= 0 ? (
          <div
            className="pointer-events-none absolute z-10 w-[min(calc(100%-16px),220px)] rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg"
            style={{ left: tooltipOffset.left, top: tooltipOffset.top }}
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs font-medium text-slate-800">{metricLabel}</span>
              {showCompare ? (
                <span
                  className={
                    pctFmt.tone === "down"
                      ? "rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-rose-700"
                      : pctFmt.tone === "up"
                        ? "rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800"
                        : "rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600"
                  }
                >
                  {pctFmt.text}
                </span>
              ) : null}
            </div>
            <div className="mt-2 space-y-2">
              <div className="flex items-start gap-2 text-xs">
                <span
                  className="mt-0.5 size-2.5 shrink-0 rounded-sm bg-[var(--primary)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-500">
                    {formatUtcBucketLabel(todayParts.y, todayParts.m, todayParts.d, hoverHour)}
                  </p>
                  <p className="font-semibold tabular-nums text-slate-900">
                    {formatSeriesValue(valueUnit, hoverTodayHourly, currency)}
                  </p>
                </div>
              </div>
              {showCompare && hoverCompareHourly != null ? (
                <div className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 size-2.5 shrink-0 rounded-sm bg-slate-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-500">
                      {formatUtcBucketLabel(
                        compareParts.y,
                        compareParts.m,
                        compareParts.d,
                        hoverHour,
                      )}
                    </p>
                    <p className="font-semibold tabular-nums text-slate-800">
                      {formatSeriesValue(valueUnit, hoverCompareHourly, currency)}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
