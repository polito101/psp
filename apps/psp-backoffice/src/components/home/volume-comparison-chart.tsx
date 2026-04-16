"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OpsVolumeHourlyResponse } from "@/lib/api/contracts";
import { formatAmountMinor } from "@/lib/ops-transaction-display";

const PAD = { t: 16, r: 12, b: 40, l: 48 };
const MIN_CHART_W = 280;
const ASPECT = 0.34;

function buildPath(
  series: (number | null)[],
  yMax: number,
  w: number,
  h: number,
): { d: string; lastIndex: number } {
  const innerW = w - PAD.l - PAD.r;
  const innerH = h - PAD.t - PAD.b;
  const toX = (i: number) => PAD.l + (i / 23) * innerW;
  const toY = (v: number) => PAD.t + innerH - (yMax <= 0 ? 0 : (v / yMax) * innerH);
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

function formatAxisMinor(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Volumen bruto del intervalo [h,h) a partir de serie acumulada (minor). */
function hourlyFromCumulative(cumulative: number[]): number[] {
  return cumulative.map((v, h) => (h === 0 ? v : v - cumulative[h - 1]));
}

function hourlyTodayFromCumulative(
  cumulative: (number | null)[],
  maxHour: number,
): (number | null)[] {
  const out: (number | null)[] = Array(24).fill(null);
  if (maxHour < 0) return out;
  for (let h = 0; h <= maxHour; h++) {
    const cur = cumulative[h];
    if (cur == null) continue;
    const prev = h === 0 ? 0 : cumulative[h - 1];
    out[h] = h === 0 ? cur : cur - (prev as number);
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

function hourOverHourPct(todayMinor: number, yesterdayMinor: number): number | null {
  if (yesterdayMinor === 0) {
    if (todayMinor === 0) return 0;
    return null;
  }
  return ((todayMinor - yesterdayMinor) / yesterdayMinor) * 100;
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

type Props = { data: OpsVolumeHourlyResponse };

/**
 * Gráfico de líneas: volumen acumulado hoy (UTC) vs ayer, hover hora a hora con % vs mismo bucket ayer.
 */
export function VolumeComparisonChart({ data }: Props) {
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

  const maxTodayHour = useMemo(() => {
    let m = -1;
    data.todayCumulativeVolumeMinor.forEach((v, i) => {
      if (v != null) m = i;
    });
    return m;
  }, [data.todayCumulativeVolumeMinor]);

  const yesterdayHourly = useMemo(
    () => hourlyFromCumulative(data.yesterdayCumulativeVolumeMinor),
    [data.yesterdayCumulativeVolumeMinor],
  );

  const todayHourly = useMemo(
    () => hourlyTodayFromCumulative(data.todayCumulativeVolumeMinor, maxTodayHour),
    [data.todayCumulativeVolumeMinor, maxTodayHour],
  );

  const yMax = useMemo(() => {
    const yLast = data.yesterdayCumulativeVolumeMinor[23] ?? 0;
    let tMax = 0;
    for (const v of data.todayCumulativeVolumeMinor) {
      if (typeof v === "number" && v > tMax) tMax = v;
    }
    return Math.max(1, yLast, tMax);
  }, [data.todayCumulativeVolumeMinor, data.yesterdayCumulativeVolumeMinor]);

  const yesterdayPath = useMemo(
    () =>
      buildPath(
        data.yesterdayCumulativeVolumeMinor.map((v) => v),
        yMax,
        chartW,
        chartH,
      ),
    [data.yesterdayCumulativeVolumeMinor, yMax, chartW, chartH],
  );

  const todayPath = useMemo(
    () => buildPath(data.todayCumulativeVolumeMinor, yMax, chartW, chartH),
    [data.todayCumulativeVolumeMinor, yMax, chartW, chartH],
  );

  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => Math.round((yMax * i) / steps));
  }, [yMax]);

  const innerH = chartH - PAD.t - PAD.b;
  const innerW = chartW - PAD.l - PAD.r;

  const { y: cy, m: cm, d: cd } = utcCalendarDates();
  const fixYest = (() => {
    const dt = new Date(Date.UTC(cy, cm, cd - 1));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
  })();

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

  const toY = (v: number) => PAD.t + innerH - (yMax <= 0 ? 0 : (v / yMax) * innerH);

  const hoverYestCum =
    hoverHour != null ? data.yesterdayCumulativeVolumeMinor[hoverHour] ?? null : null;
  const hoverTodayCum =
    hoverHour != null ? data.todayCumulativeVolumeMinor[hoverHour] ?? null : null;

  const hoverYestHourly = hoverHour != null ? yesterdayHourly[hoverHour] ?? 0 : null;
  const hoverTodayHourly = hoverHour != null ? todayHourly[hoverHour] : null;

  const pct =
    hoverTodayHourly != null && hoverYestHourly != null
      ? hourOverHourPct(hoverTodayHourly, hoverYestHourly)
      : null;
  const pctFmt = formatPct(pct);

  const utcTimeLabel = formatUtcClock();

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-700">Volumen bruto</div>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900 sm:text-4xl">
            {formatAmountMinor(data.totals.todayVolumeMinor, data.currency)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{utcTimeLabel} UTC</p>
        </div>
        <div className="shrink-0 sm:min-w-[140px] sm:text-right">
          <div className="text-sm font-medium text-slate-700 sm:text-right">Ayer</div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-700 sm:text-3xl">
            {formatAmountMinor(data.totals.yesterdayVolumeMinor, data.currency)}
          </p>
        </div>
      </div>

      <div ref={chartInteractRef} className="relative">
        <svg
          data-chart-svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="h-auto w-full touch-none select-none text-slate-600"
          role="img"
          aria-label="Volumen acumulado hoy frente a ayer por hora UTC"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onPointerDown={onPointerMove}
        >
          <rect x="0" y="0" width={chartW} height={chartH} fill="white" rx="8" />
          {yTicks.map((tick) => {
            const y = PAD.t + innerH - (yMax <= 0 ? 0 : (tick / yMax) * innerH);
            return (
              <g key={tick}>
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
                  {formatAxisMinor(tick)}
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
          {yesterdayPath.d ? (
            <path
              d={yesterdayPath.d}
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
          hoverYestCum != null &&
          pointerXSvg != null &&
          maxTodayHour >= 0 ? (
            <circle
              cx={pointerXSvg}
              cy={toY(hoverYestCum)}
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
              const v = data.todayCumulativeVolumeMinor[todayPath.lastIndex];
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
        hoverYestHourly != null &&
        pointerXSvg != null &&
        tooltipOffset != null &&
        maxTodayHour >= 0 ? (
          <div
            className="pointer-events-none absolute z-10 w-[min(calc(100%-16px),220px)] rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-lg"
            style={{ left: tooltipOffset.left, top: tooltipOffset.top }}
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-xs font-medium text-slate-800">Volumen bruto</span>
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
                    {formatAmountMinor(hoverTodayHourly, data.currency)}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 size-2.5 shrink-0 rounded-sm bg-slate-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-500">
                    {formatUtcBucketLabel(fixYest.y, fixYest.m, fixYest.d, hoverHour)}
                  </p>
                  <p className="font-semibold tabular-nums text-slate-800">
                    {formatAmountMinor(hoverYestHourly, data.currency)}
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
          Ayer (UTC)
        </span>
      </div>
    </div>
  );
}
