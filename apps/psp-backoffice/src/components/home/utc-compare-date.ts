/** Día calendario UTC como `YYYY-MM-DD`. */
export function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addUtcCalendarDaysFromYmd(ymd: string, deltaDays: number): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + deltaDays));
  return utcYmd(dt);
}

export function parseUtcYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(month0) || !Number.isFinite(d)) return null;
  return { y, m: month0, d };
}

export function formatUtcYmdLong(ymd: string): string {
  const p = parseUtcYmdParts(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.y, p.m, p.d, 12, 0, 0, 0));
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dt);
}
