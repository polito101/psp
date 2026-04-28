"use client";

import { useMemo } from "react";
import type { OpsVolumeHourlyMetric, OpsVolumeHourlyResponse } from "@/lib/api/contracts";
import { amountMinorToBigInt, formatAmountMinor } from "@/lib/ops-transaction-display";
import { Select } from "@/components/ui/select";
import { addUtcCalendarDaysFromYmd, formatUtcYmdLong, utcYmd } from "./utc-compare-date";
import { OpsCumulativeHourlyChart } from "./ops-cumulative-hourly-chart";

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

function formatUtcClock(): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
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

  const utcTimeLabel = formatUtcClock();

  const yesterdayUtcYmd = addUtcCalendarDaysFromYmd(utcYmd(new Date()), -1);
  const compareDayTitle =
    data.compareUtcDate === yesterdayUtcYmd ? "Ayer" : formatUtcYmdLong(data.compareUtcDate);

  const metricLabel =
    data.metric === "succeeded_count"
      ? "Pagos satisfactorios"
      : data.metric === "volume_net"
        ? "Volumen neto"
        : "Volumen bruto";

  return (
    <div className="w-full">
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
              <option value="volume_gross">Volumen bruto</option>
              <option value="volume_net">Volumen neto</option>
              <option value="succeeded_count">Pagos satisfactorios</option>
            </Select>
          </div>
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900 sm:text-4xl">
            {formatSeriesValue(data.valueUnit, data.totals.todayVolumeMinor, data.currency)}
          </p>
          <p className="text-xs text-slate-500">{utcTimeLabel} UTC</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:min-w-[200px] sm:items-end sm:text-right">
          <div className="w-full sm:w-auto sm:max-w-[200px]">
            <input
              id="home-volume-chart-compare"
              type="date"
              aria-label="Fecha de comparación en calendario UTC"
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

      <OpsCumulativeHourlyChart
        todayCumulative={parsedToday}
        compareCumulative={parsedCompare}
        valueUnit={data.valueUnit}
        currency={data.currency}
        metricLabel={metricLabel}
        todayUtcYmd={utcYmd(new Date())}
        compareUtcYmd={data.compareUtcDate}
        showCompare
        seriesParseInvalid={seriesParseInvalid}
        className="w-full"
      />
    </div>
  );
}
