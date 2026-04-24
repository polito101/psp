"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OpsPaymentsSummaryResponse } from "@/lib/api/contracts";
import { fetchOpsPaymentsSummary } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { formatAmountMinor } from "@/lib/ops-transaction-display";
import {
  computeCompareYmdRange,
  defaultSummaryCurrentRangeYmd,
  type SummaryComparatorMode,
  utcYmdRangeToIsoRange,
} from "./admin-summary-range";

const SUMMARY_CURRENCY = "EUR";

function formatBigIntCount(n: bigint): string {
  if (n <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return new Intl.NumberFormat("es-ES").format(Number(n));
  }
  return n.toString();
}

function parseBig(s: string): bigint {
  try {
    return BigInt(s.trim());
  } catch {
    return 0n;
  }
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

function formatCountDelta(current: bigint, prev: bigint): string {
  const d = current - prev;
  const sign = d > 0n ? "+" : "";
  return `${sign}${d.toString()}`;
}

function SummaryMetricCard(props: {
  title: string;
  currentDisplay: string;
  compareDisplay: string;
  deltaAbsLabel: string;
  deltaPct: number | null;
  invertDeltaColors?: boolean;
}) {
  const pct = props.deltaPct;
  const pctText = formatDeltaPct(pct);
  const upGood = !props.invertDeltaColors;
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
    <Card>
      <CardHeader className="border-b-0 pb-2">
        <CardDescription>{props.title}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{props.currentDisplay}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-0 text-xs text-slate-600">
        <p>
          vs comparación: <span className="font-medium text-slate-800">{props.compareDisplay}</span>
        </p>
        <p>
          Δ absoluto: <span className="font-medium text-slate-800">{props.deltaAbsLabel}</span>
        </p>
        <p className={pctClass}>Δ %: {pctText}</p>
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

  const summaryRangeValid =
    currentFromYmd <= currentToYmd &&
    compareYmd.fromYmd <= compareYmd.toYmd &&
    (comparatorMode !== "custom" || customFromYmd <= customToYmd);

  const summaryQuery = useQuery<OpsPaymentsSummaryResponse>({
    queryKey: ["home-ops-payments-summary", summaryFilters],
    queryFn: () => fetchOpsPaymentsSummary(summaryFilters),
    staleTime: 30_000,
    enabled: summaryRangeValid,
  });

  const cur = summaryQuery.data?.current;
  const cmp = summaryQuery.data?.compare;

  const paymentsCur = cur ? parseBig(cur.paymentsTotal) : null;
  const paymentsCmp = cmp ? parseBig(cmp.paymentsTotal) : null;
  const grossCur = cur ? parseBig(cur.grossVolumeMinor) : null;
  const grossCmp = cmp ? parseBig(cmp.grossVolumeMinor) : null;
  const netCur = cur ? parseBig(cur.netVolumeMinor) : null;
  const netCmp = cmp ? parseBig(cmp.netVolumeMinor) : null;
  const errCur = cur ? parseBig(cur.paymentErrorsTotal) : null;
  const errCmp = cmp ? parseBig(cmp.paymentErrorsTotal) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Resumen</CardTitle>
        <CardDescription>
          Intervalo y comparación en <span className="font-medium">calendario UTC</span> (filtro{" "}
          <span className="font-medium">{SUMMARY_CURRENCY}</span>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
                onChange={(e) => setCurrentToYmd(e.target.value)}
              />
            </div>
          </div>
          <div className="min-w-[220px] flex-1 lg:max-w-xs">
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="resumen-comparador">
              Comparador
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
                onChange={(e) => setCustomToYmd(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {!summaryRangeValid ? (
          <p className="text-sm text-amber-800">Revisa los rangos de fechas (desde ≤ hasta, UTC).</p>
        ) : summaryQuery.isError ? (
          <p className="text-sm text-rose-700">{(summaryQuery.error as Error).message}</p>
        ) : summaryQuery.isLoading || !cur || !cmp ? (
          <p className="text-sm text-slate-500">Cargando resumen…</p>
        ) : (
          <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetricCard
              title="Payments"
              currentDisplay={formatBigIntCount(paymentsCur ?? 0n)}
              compareDisplay={formatBigIntCount(paymentsCmp ?? 0n)}
              deltaAbsLabel={formatCountDelta(paymentsCur ?? 0n, paymentsCmp ?? 0n)}
              deltaPct={deltaPct(paymentsCur ?? 0n, paymentsCmp ?? 0n)}
            />
            <SummaryMetricCard
              title="Volumen bruto"
              currentDisplay={formatAmountMinor(cur.grossVolumeMinor, SUMMARY_CURRENCY)}
              compareDisplay={formatAmountMinor(cmp.grossVolumeMinor, SUMMARY_CURRENCY)}
              deltaAbsLabel={formatAmountMinor(
                (grossCur ?? 0n) - (grossCmp ?? 0n),
                SUMMARY_CURRENCY,
              )}
              deltaPct={deltaPct(grossCur ?? 0n, grossCmp ?? 0n)}
            />
            <SummaryMetricCard
              title="Volumen neto"
              currentDisplay={formatAmountMinor(cur.netVolumeMinor, SUMMARY_CURRENCY)}
              compareDisplay={formatAmountMinor(cmp.netVolumeMinor, SUMMARY_CURRENCY)}
              deltaAbsLabel={formatAmountMinor((netCur ?? 0n) - (netCmp ?? 0n), SUMMARY_CURRENCY)}
              deltaPct={deltaPct(netCur ?? 0n, netCmp ?? 0n)}
            />
            <SummaryMetricCard
              title="Errores en los pagos"
              currentDisplay={formatBigIntCount(errCur ?? 0n)}
              compareDisplay={formatBigIntCount(errCmp ?? 0n)}
              deltaAbsLabel={formatCountDelta(errCur ?? 0n, errCmp ?? 0n)}
              deltaPct={deltaPct(errCur ?? 0n, errCmp ?? 0n)}
              invertDeltaColors
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
