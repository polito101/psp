"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OpsVolumeHourlyMetric, OpsVolumeHourlyResponse } from "@/lib/api/contracts";
import { amountMinorToBigInt, formatAmountMinor } from "@/lib/ops-transaction-display";
import { Select } from "@/components/ui/select";
import { formatUtcYmdLong, parseUtcYmdParts } from "./utc-compare-date";

const PAD = { t: 16, r: 12, b: 40, l: 48 };
const MIN_CHART_W = 280;
const ASPECT = 0.34;

/**
 * Aproxima num/den en coma flotante sin hacer `Number(num)` cuando el acumulado puede
 * superar `MAX_SAFE_INTEGER` (evita distorsión del trazado SVG).
 */
function bigintRatioToNumber(num: bigint, den: bigint): number {
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

function buildPath(
  series: (bigint | null)[],
  yMax: bigint,
  w: number,
  h: number,
): { d: string; lastIndex: number } {
  const innerW = w - PAD.l - PAD.r;
  const innerH = h - PAD.t - PAD.b;
  const toX = (i: number) => PAD.l + (i / 23) * innerW;
  const toY = (v: bigint) =>
    PAD.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(v, yMax) * innerH);
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

function formatUtcClock(): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
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

type Props = {
  data: OpsVolumeHourlyResponse;
  metric: OpsVolumeHourlyMetric;
  onMetricChange: (m: OpsVolumeHourlyMetric) => void;
  compareUtcDate: string;
  onCompareUtcDateChange: (ymd: string) => void;
  compareDateMin: string;
  compareDateMax: string;
};

/**
 * Gráfico de líneas: acumulado hoy (UTC) vs día de comparación, hover hora a hora con % vs mismo bucket.
 */
export function VolumeComparisonChart({
  data,
  metric,
  onMetricChange,
  compareUtcDate,
  onCompareUtcDateChange,
  compareDateMin,
  compareDateMax,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(MIN_CHART_W);
  const [, setClockTick] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setChartW(Math.max(MIN_CHART_W, Math.floor(cr.width)));
    });
    ro.observe(el);
    setChartW(Math.max(MIN_CHART_W, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const chartH = Math.max(200, Math.round(chartW * ASPECT));

  const parsedToday = useMemo(
    () =>
      data.todayCumulativeVolumeMinor.map((v) =>
        v == null ? null : amountMinorToBigInt(v),
      ),
    [data.todayCumulativeVolumeMinor],
  );

  const parsedCompare = useMemo(
    () => data.compareCumulativeVolumeMinor.map((v) => amountMinorToBigInt(v)),
    [data.compareCumulativeVolumeMinor],
  );

  const seriesParseInvalid = useMemo(() => {
    if (data.todayCumulativeVolumeMinor.some((v, i) => v != null && parsedToday[i] == null)) return true;
    if (parsedCompare.some((v) => v == null)) return true;
    if (amountMinorToBigInt(data.totals.todayVolumeMinor) == null) return true;
    if (amountMinorToBigInt(data.totals.compareDayVolumeMinor) == null) return true;
    return false;
  }, [data.totals, data.todayCumulativeVolumeMinor, parsedToday, parsedCompare]);

  const maxTodayHour = useMemo(() => {
    let m = -1;
    data.todayCumulativeVolumeMinor.forEach((v, i) => {
      if (v != null) m = i;
    });
    return m;
  }, [data.todayCumulativeVolumeMinor]);

  const compareDayHourly = useMemo(() => hourlyFromCumulative(parsedCompare), [parsedCompare]);

  const todayHourly = useMemo(
    () => hourlyTodayFromCumulative(parsedToday, maxTodayHour),
    [parsedToday, maxTodayHour],
  );

  const yMax = useMemo(() => {
    const cLast = parsedCompare[23] ?? 0n;
    let tMax = 0n;
    for (const v of parsedToday) {
      if (v != null && v > tMax) tMax = v;
    }
    const m = cLast > tMax ? cLast : tMax;
    return m > 0n ? m : 1n;
  }, [parsedToday, parsedCompare]);

  const comparePath = useMemo(
    () => buildPath(parsedCompare, yMax, chartW, chartH),
    [parsedCompare, yMax, chartW, chartH],
  );

  const todayPath = useMemo(
    () => buildPath(parsedToday, yMax, chartW, chartH),
    [parsedToday, yMax, chartW, chartH],
  );

  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => (yMax * BigInt(i)) / BigInt(steps));
  }, [yMax]);

  const innerH = chartH - PAD.t - PAD.b;
  const innerW = chartW - PAD.l - PAD.r;

  const { y: cy, m: cm, d: cd } = utcCalendarDates();
  const compareFallback = new Date(Date.UTC(cy, cm, cd - 1));
  const compareParts =
    parseUtcYmdParts(data.compareUtcDate) ?? {
      y: compareFallback.getUTCFullYear(),
      m: compareFallback.getUTCMonth(),
      d: compareFallback.getUTCDate(),
    };

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
      if (xSvg < PAD.l || xSvg > chartW - PAD.r) return null;
      const t = (xSvg - PAD.l) / innerW;
      const raw = Math.round(t * 23);
      return Math.max(0, Math.min(23, raw));
    },
    [chartW, innerW],
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
      const xSvg = PAD.l + (clamped / 23) * innerW;
      setPointerXSvg(xSvg);

      const box = chartInteractRef.current?.getBoundingClientRect();
      if (box) {
        const x = e.clientX - box.left;
        const tipW = 220;
        const pad = 8;
        const flip = x > box.width * 0.52;
        const left = flip ? Math.max(pad, x - tipW - pad) : Math.min(x + pad, box.width - tipW - pad);
        setTooltipOffset({ left, top: pad });
      }
    },
    [toHourFromClientX, maxTodayHour, innerW],
  );

  const onPointerLeave = useCallback(() => {
    setHoverHour(null);
    setPointerXSvg(null);
    setTooltipOffset(null);
  }, []);

  const toY = (v: bigint) =>
    PAD.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(v, yMax) * innerH);

  const hoverCompareCum = hoverHour != null ? parsedCompare[hoverHour] ?? null : null;
  const hoverTodayCum = hoverHour != null ? parsedToday[hoverHour] ?? null : null;

  const hoverCompareHourly = hoverHour != null ? compareDayHourly[hoverHour] : null;
  const hoverTodayHourly = hoverHour != null ? todayHourly[hoverHour] : null;

  const pct =
    hoverTodayHourly != null && hoverCompareHourly != null
      ? hourOverHourPct(hoverTodayHourly, hoverCompareHourly)
      : null;
  const pctFmt = formatPct(pct);

  const utcTimeLabel = formatUtcClock();

  const compareDayTitle = formatUtcYmdLong(data.compareUtcDate);

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="max-w-xs">
            <label htmlFor="home-volume-chart-metric" className="sr-only">
              Métrica del gráfico
            </label>
            <Select
              id="home-volume-chart-metric"
              value={metric}
              onChange={(e) => onMetricChange(e.target.value as OpsVolumeHourlyMetric)}
            >
              <option value="volume_net">Volumen neto</option>
              <option value="succeeded_count">Pagos satisfactorios</option>
            </Select>
          </div>
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900 sm:text-4xl">
            {formatSeriesValue(data.valueUnit, data.totals.todayVolumeMinor, data.currency)}
          </p>
          <p className="text-xs text-slate-500">
            {utcTimeLabel} UTC · Hoy (acum.) · moneda filtro:{" "}
            <span className="font-medium">{data.currency}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:min-w-[200px] sm:items-end sm:text-right">
          <div className="w-full sm:w-auto sm:max-w-[200px]">
            <label htmlFor="home-volume-chart-compare" className="mb-1 block text-xs font-medium text-slate-600">
              Comparación (día UTC)
            </label>
            <input
              id="home-volume-chart-compare"
              type="date"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-400 sm:text-right"
              min={compareDateMin}
              max={compareDateMax}
              value={compareUtcDate}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v >= compareDateMin && v <= compareDateMax) onCompareUtcDateChange(v);
              }}
            />
          </div>
          <div className="text-sm font-medium text-slate-700 sm:text-right">{compareDayTitle}</div>
          <p className="text-2xl font-semibold tabular-nums text-slate-700 sm:text-3xl">
            {formatSeriesValue(data.valueUnit, data.totals.compareDayVolumeMinor, data.currency)}
          </p>
        </div>
      </div>

      {seriesParseInvalid ? (
        <div
          className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="alert"
        >
          Los importes en unidades menores del payload no son enteros decimales válidos; el gráfico puede
          aparecer incompleto. Revisa la respuesta de volumen horario.
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
              PAD.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(tick, yMax) * innerH);
            return (
              <g key={tick.toString()}>
                <line
                  x1={PAD.l}
                  x2={chartW - PAD.r}
                  y1={y}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
                <text
                  x={PAD.l - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px]"
                >
                  {formatAxisMinorUnits(tick)}
                </text>
              </g>
            );
          })}
          {[0, 6, 12, 18, 23].map((h) => {
            const x = PAD.l + (h / 23) * innerW;
            return (
              <text
                key={h}
                x={x}
                y={chartH - 12}
                textAnchor="middle"
                className="fill-slate-500 text-[10px]"
              >
                {data.labels[h] ?? `${String(h).padStart(2, "0")}:00`}
              </text>
            );
          })}
          {comparePath.d ? (
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
              y1={PAD.t}
              y2={PAD.t + innerH}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="3 3"
              pointerEvents="none"
            />
          ) : null}
          {hoverHour != null &&
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
              const x = PAD.l + (todayPath.lastIndex / 23) * innerW;
              const y = toY(v);
              return (
                <circle cx={x} cy={y} r={4} fill="var(--primary)" stroke="#fff" strokeWidth={2} />
              );
            })()
          ) : null}
        </svg>

        {hoverHour != null &&
        hoverTodayHourly != null &&
        hoverCompareHourly != null &&
        pointerXSvg != null &&
        tooltipOffset != null &&
        maxTodayHour >= 0 ? (
          <div
            className="pointer-events-none absolute z-10 w-[min(calc(100%-16px),220px)] rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg"
            style={{ left: tooltipOffset.left, top: tooltipOffset.top }}
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs font-medium text-slate-800">
                {data.metric === "succeeded_count" ? "Pagos satisfactorios" : "Volumen neto"}
              </span>
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
            </div>
            <div className="mt-2 space-y-2">
              <div className="flex items-start gap-2 text-xs">
                <span
                  className="mt-0.5 size-2.5 shrink-0 rounded-sm bg-[var(--primary)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-500">{formatUtcBucketLabel(cy, cm, cd, hoverHour)}</p>
                  <p className="font-semibold tabular-nums text-slate-900">
                    {formatSeriesValue(data.valueUnit, hoverTodayHourly, data.currency)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 size-2.5 shrink-0 rounded-sm bg-slate-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-500">
                    {formatUtcBucketLabel(compareParts.y, compareParts.m, compareParts.d, hoverHour)}
                  </p>
                  <p className="font-semibold tabular-nums text-slate-800">
                    {formatSeriesValue(data.valueUnit, hoverCompareHourly, data.currency)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-full bg-[var(--primary)]" aria-hidden />
          Hoy (UTC)
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width={18} height={3} className="shrink-0 text-slate-400" aria-hidden>
            <line x1="0" y1="1.5" x2="18" y2="1.5" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Comparación: {compareDayTitle} (UTC)
        </span>
      </div>
    </div>
  );
}
