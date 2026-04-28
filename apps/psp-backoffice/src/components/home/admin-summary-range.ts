/** Modo de ventana de comparación respecto al intervalo principal (días UTC). */
export type SummaryComparatorMode = "previous_period" | "previous_month" | "previous_year" | "custom";

/**
 * Días máximos por ventana (inclusive, calendario UTC), alineado con
 * `PaymentsV2Service.OPS_PAYMENTS_SUMMARY_MAX_DAYS` en `psp-api` (summary / summary-daily).
 */
export const OPS_PAYMENTS_SUMMARY_MAX_DAYS_UTC = 124;

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

/** Inicio del día UTC siguiente al YMD dado (`d+1` normaliza mes/año en Date.UTC). */
function utcNextDayStartMs(y: number, m0: number, d: number): number {
  return Date.UTC(y, m0, d + 1, 0, 0, 0, 0);
}

/**
 * Convierte rango calendario YYYY-MM-DD (UTC) a ISO para la API: ventana half-open `[fromIso, toIso)`.
 * `toIso` es 00:00:00.000Z del día siguiente al último día inclusive del rango.
 */
export function utcYmdRangeToIsoRange(fromYmd: string, toYmd: string): { fromIso: string; toIso: string } {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) {
    throw new Error("Invalid YYYY-MM-DD range");
  }
  const fromMs = utcDayStartMs(a.y, a.m0, a.d);
  const toExclusiveMs = utcNextDayStartMs(b.y, b.m0, b.d);
  if (fromMs >= toExclusiveMs) {
    throw new Error("Invalid YYYY-MM-DD range: from must be <= to");
  }
  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toExclusiveMs).toISOString(),
  };
}

function shiftYmdByMonths(ymd: string, deltaMonths: number): string {
  const p = parseYmd(ymd);
  if (!p) throw new Error("Invalid date");
  const dt = new Date(Date.UTC(p.y, p.m0 + deltaMonths, p.d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Día calendario UTC de hoy (`YYYY-MM-DD`). */
export function utcTodayYmd(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

/** Un solo día UTC: hoy. */
export function defaultSummaryTodayYmd(): { fromYmd: string; toYmd: string } {
  const t = utcTodayYmd();
  return { fromYmd: t, toYmd: t };
}

/** Rango por defecto: últimos 7 días calendario UTC inclusive hasta hoy. */
export function defaultSummaryCurrentRangeYmd(): { fromYmd: string; toYmd: string } {
  const toYmd = utcTodayYmd();
  const from = addUtcCalendarDaysYmd(toYmd, -6);
  if (!from) throw new Error("Invalid today YMD");
  return { fromYmd: from, toYmd };
}

/**
 * Últimos `dayCount` días calendario UTC inclusive hasta hoy (`dayCount` >= 1).
 * Ej.: 7 = misma ventana que `defaultSummaryCurrentRangeYmd`.
 */
export function utcLastNDaysInclusiveUntilTodayYmd(dayCount: number): { fromYmd: string; toYmd: string } {
  if (dayCount < 1) throw new Error("dayCount must be >= 1");
  const toYmd = utcTodayYmd();
  const from = addUtcCalendarDaysYmd(toYmd, -(dayCount - 1));
  if (!from) throw new Error("Invalid range");
  return { fromYmd: from, toYmd };
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
  const curExclusiveEndMs = utcNextDayStartMs(b.y, b.m0, b.d);
  const duration = curExclusiveEndMs - fromMs;
  const compareExclusiveEndMs = fromMs;
  const compareStartMs = compareExclusiveEndMs - duration;
  const cFrom = new Date(compareStartMs);
  const cTo = new Date(compareExclusiveEndMs - 1);
  const fromYmd = `${cFrom.getUTCFullYear()}-${String(cFrom.getUTCMonth() + 1).padStart(2, "0")}-${String(cFrom.getUTCDate()).padStart(2, "0")}`;
  const toYmd = `${cTo.getUTCFullYear()}-${String(cTo.getUTCMonth() + 1).padStart(2, "0")}-${String(cTo.getUTCDate()).padStart(2, "0")}`;
  return { fromYmd, toYmd };
}

/** Días calendario UTC entre dos YYYY-MM-DD (inclusive). Devuelve `null` si el formato o el orden es inválido. */
export function utcInclusiveDayCountYmd(fromYmd: string, toYmd: string): number | null {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return null;
  const start = Date.UTC(a.y, a.m0, a.d);
  const end = Date.UTC(b.y, b.m0, b.d);
  if (start > end) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** Suma `deltaDays` al día UTC de `ymd` (YYYY-MM-DD). */
export function addUtcCalendarDaysYmd(ymd: string, deltaDays: number): string | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const t = new Date(Date.UTC(p.y, p.m0, p.d + deltaDays));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
