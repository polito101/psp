"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { utcTodayYmd } from "./admin-summary-range";

/** Misma geometría base que `VolumeComparisonChart` (sin etiquetas en el eje X). */
const PAD = { t: 16, r: 12, b: 14, l: 48 };
const MIN_CHART_W = 280;
const ASPECT = 0.34;

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

function parseIncrementalRow(arr: string[]): bigint[] {
  return arr.slice(0, 24).map((s) => {
    try {
      return BigInt(String(s).trim());
    } catch {
      return 0n;
    }
  });
}

function toCumulative(incr: bigint[]): bigint[] {
  let s = 0n;
  return incr.map((v) => {
    s += v;
    return s;
  });
}

/** Igual que el volumen principal: `max(último acumulado comparación, max acumulado actual visibles)`. */
function yMaxLikeMainVolumeMasked(todayCum: (bigint | null)[], compareCum: bigint[]): bigint {
  const cLast = compareCum.length >= 24 ? compareCum[23]! : 0n;
  let tMax = 0n;
  for (const v of todayCum) {
    if (v != null && v > tMax) tMax = v;
  }
  const m = cLast > tMax ? cLast : tMax;
  return m > 0n ? m : 1n;
}

function yMaxSingleMasked(series: (bigint | null)[]): bigint {
  let tMax = 0n;
  for (const v of series) {
    if (v != null && v > tMax) tMax = v;
  }
  return tMax > 0n ? tMax : 1n;
}

function buildPathCumulative24(cum: bigint[], yMax: bigint, chartW: number, chartH: number): string {
  const innerW = chartW - PAD.l - PAD.r;
  const innerH = chartH - PAD.t - PAD.b;
  let d = "";
  for (let i = 0; i < 24; i++) {
    const v = cum[i] ?? 0n;
    const x = PAD.l + (i / 23) * innerW;
    const y = PAD.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(v, yMax) * innerH);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

/** Trazado con saltos (`M`) donde la serie es `null` (p. ej. horas futuras del día UTC actual). */
function buildPathFromNullableCumulative(
  series: (bigint | null)[],
  yMax: bigint,
  chartW: number,
  chartH: number,
): string {
  const innerW = chartW - PAD.l - PAD.r;
  const innerH = chartH - PAD.t - PAD.b;
  const toX = (i: number) => PAD.l + (i / 23) * innerW;
  const toY = (v: bigint) =>
    PAD.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(v, yMax) * innerH);
  let d = "";
  let penUp = true;
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
  }
  return d;
}

export type ResumenHourlyLineChartProps = {
  incrementalCurrent: string[];
  incrementalCompare: string[];
  showCompare: boolean;
  /** Día UTC del intervalo actual (para cortar la línea en la hora actual si es hoy). */
  utcYmdCurrent: string;
};

/**
 * Líneas horarias estilo `VolumeComparisonChart`: serie **acumulada** por hora (0–23 UTC),
 * rejilla Y, sin etiquetas bajo el eje X; la línea del periodo actual no continúa más allá de la hora UTC actual cuando el día es hoy.
 */
export function ResumenHourlyLineChart(props: ResumenHourlyLineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(MIN_CHART_W);

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

  const chartH = Math.max(200, Math.round(chartW * ASPECT));

  const incCur = parseIncrementalRow(props.incrementalCurrent);
  const incCmp = parseIncrementalRow(props.incrementalCompare);
  const cumCur = toCumulative(incCur);
  const cumCmp = toCumulative(incCmp);

  const isCurrentUtcToday = props.utcYmdCurrent === utcTodayYmd();
  const currentUtcHour = new Date().getUTCHours();
  const cumCurMasked: (bigint | null)[] = cumCur.map((v, i) =>
    isCurrentUtcToday && i > currentUtcHour ? null : v,
  );

  const yMax = props.showCompare
    ? yMaxLikeMainVolumeMasked(cumCurMasked, cumCmp)
    : yMaxSingleMasked(cumCurMasked);

  const dCur = buildPathFromNullableCumulative(cumCurMasked, yMax, chartW, chartH);
  const dCmp = buildPathCumulative24(cumCmp, yMax, chartW, chartH);

  const yTicks = Array.from({ length: 5 }, (_, i) => (yMax * BigInt(i)) / 4n);
  const innerH = chartH - PAD.t - PAD.b;

  const toY = (v: bigint) =>
    PAD.t + innerH - (yMax <= 0n ? 0 : bigintRatioToNumber(v, yMax) * innerH);

  return (
    <div ref={wrapRef} className="w-full">
      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="h-auto w-full touch-none select-none text-slate-600"
        role="img"
        aria-label="Serie acumulada por hora UTC (mismo cálculo visual que el gráfico de volumen)"
      >
        <rect x={0} y={0} width={chartW} height={chartH} fill="white" rx={8} stroke="#e2e8f0" strokeWidth={1} />
        {yTicks.map((tick) => {
          const y = toY(tick);
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
              <text x={PAD.l - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
                {formatAxisMinorUnits(tick)}
              </text>
            </g>
          );
        })}
        {props.showCompare && dCmp ? (
          <path
            d={dCmp}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="5 4"
          />
        ) : null}
        {dCur ? (
          <path
            d={dCur}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    </div>
  );
}
