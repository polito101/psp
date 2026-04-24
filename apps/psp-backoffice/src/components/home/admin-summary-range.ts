/** Modo de ventana de comparación respecto al intervalo principal (días UTC). */
export type SummaryComparatorMode = "previous_period" | "previous_month" | "previous_year" | "custom";

function parseYmd(ymd: string): { y: number; m0: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return { y, m0: mo, d };
}

function utcDayStartMs(y: number, m0: number, d: number): number {
  return Date.UTC(y, m0, d, 0, 0, 0, 0);
}

function utcDayEndMs(y: number, m0: number, d: number): number {
  return Date.UTC(y, m0, d, 23, 59, 59, 999);
}

/** Convierte rango inclusive YYYY-MM-DD (UTC) a ISO para la API (`created_at` gte/lte). */
export function utcYmdRangeToIsoRange(fromYmd: string, toYmd: string): { fromIso: string; toIso: string } {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) {
    throw new Error("Invalid YYYY-MM-DD range");
  }
  return {
    fromIso: new Date(utcDayStartMs(a.y, a.m0, a.d)).toISOString(),
    toIso: new Date(utcDayEndMs(b.y, b.m0, b.d)).toISOString(),
  };
}

function shiftYmdByMonths(ymd: string, deltaMonths: number): string {
  const p = parseYmd(ymd);
  if (!p) throw new Error("Invalid date");
  const dt = new Date(Date.UTC(p.y, p.m0 + deltaMonths, p.d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Rango por defecto: últimos 7 días calendario UTC inclusive hasta hoy. */
export function defaultSummaryCurrentRangeYmd(): { fromYmd: string; toYmd: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 6 * 86_400_000);
  const toYmd = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  const fromYmd = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
  return { fromYmd, toYmd };
}

/**
 * Calcula el rango de comparación en YYYY-MM-DD (UTC) según el modo.
 * `custom` usa `compareFromYmd` / `compareToYmd` obligatorios.
 */
export function computeCompareYmdRange(
  currentFromYmd: string,
  currentToYmd: string,
  mode: SummaryComparatorMode,
  custom?: { fromYmd: string; toYmd: string },
): { fromYmd: string; toYmd: string } {
  if (mode === "custom") {
    if (!custom?.fromYmd || !custom.toYmd) {
      throw new Error("Custom comparator requires compareFromYmd and compareToYmd");
    }
    return { fromYmd: custom.fromYmd, toYmd: custom.toYmd };
  }
  if (mode === "previous_month") {
    return {
      fromYmd: shiftYmdByMonths(currentFromYmd, -1),
      toYmd: shiftYmdByMonths(currentToYmd, -1),
    };
  }
  if (mode === "previous_year") {
    return {
      fromYmd: shiftYmdByMonths(currentFromYmd, -12),
      toYmd: shiftYmdByMonths(currentToYmd, -12),
    };
  }
  const a = parseYmd(currentFromYmd);
  const b = parseYmd(currentToYmd);
  if (!a || !b) throw new Error("Invalid current range");
  const fromMs = utcDayStartMs(a.y, a.m0, a.d);
  const toMs = utcDayEndMs(b.y, b.m0, b.d);
  const duration = toMs - fromMs;
  const compareToMs = fromMs - 1;
  const compareFromMs = compareToMs - duration;
  const cFrom = new Date(compareFromMs);
  const cTo = new Date(compareToMs);
  const fromYmd = `${cFrom.getUTCFullYear()}-${String(cFrom.getUTCMonth() + 1).padStart(2, "0")}-${String(cFrom.getUTCDate()).padStart(2, "0")}`;
  const toYmd = `${cTo.getUTCFullYear()}-${String(cTo.getUTCMonth() + 1).padStart(2, "0")}-${String(cTo.getUTCDate()).padStart(2, "0")}`;
  return { fromYmd, toYmd };
}
