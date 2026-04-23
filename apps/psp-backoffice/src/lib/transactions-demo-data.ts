/**
 * Dataset demo para la vista de transacciones en `/`.
 * No representa datos reales del PSP.
 */

export type DemoUiStatus =
  | "refunded"
  | "incomplete"
  | "succeeded"
  | "not_captured"
  | "disputed"
  | "error";

export type DemoTransaction = {
  id: string;
  amountMinor: number;
  currency: "EUR" | "USD";
  status: DemoUiStatus;
  /** null => mostrar "—" en método de pago */
  paymentMethodLast4: string | null;
  description: string;
  customer: string | null;
  createdAt: string;
  refundedAt: string | null;
  /** null => "—" en columna Motivo */
  reasonLabel: string | null;
};

const BASE: DemoTransaction[] = [
  {
    id: "pi_3TMjufLApR7pSYE90q1bDcMO",
    amountMinor: 2101,
    currency: "EUR",
    status: "refunded",
    paymentMethodLast4: "4242",
    description: "(created by PSP CLI)",
    customer: null,
    createdAt: "2026-04-16T06:33:00.000Z",
    refundedAt: "2026-04-16T06:59:00.000Z",
    reasonLabel: "Enviar recibo",
  },
  {
    id: "pi_3TMjufLApR7pSYE90q1bDcMP",
    amountMinor: 2000,
    currency: "USD",
    status: "incomplete",
    paymentMethodLast4: null,
    description: "pi_3TMjufLApR7pSYE90q1bDcMP",
    customer: null,
    createdAt: "2026-04-16T05:12:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
  {
    id: "pi_3TMjugLApR7pSYE91xYzAb12",
    amountMinor: 4999,
    currency: "EUR",
    status: "succeeded",
    paymentMethodLast4: "4242",
    description: "(created by PSP CLI)",
    customer: "Acme SL",
    createdAt: "2026-04-15T14:22:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
  {
    id: "pi_3TMjuhLApR7pSYE92mNqWe34",
    amountMinor: 15050,
    currency: "USD",
    status: "not_captured",
    paymentMethodLast4: "4242",
    description: "Invoice #4412",
    customer: null,
    createdAt: "2026-04-15T11:01:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
  {
    id: "pi_3TMjuiLApR7pSYE93pQrSt56",
    amountMinor: 890,
    currency: "EUR",
    status: "succeeded",
    paymentMethodLast4: "3184",
    description: "pi_3TMjuiLApR7pSYE93pQrSt56",
    customer: "María G.",
    createdAt: "2026-04-14T18:45:00.000Z",
    refundedAt: null,
    reasonLabel: "Enviar recibo",
  },
  {
    id: "pi_3TMjujLApR7pSYE94sTuUv78",
    amountMinor: 120000,
    currency: "USD",
    status: "refunded",
    paymentMethodLast4: "4242",
    description: "(created by PSP CLI)",
    customer: null,
    createdAt: "2026-04-14T09:30:00.000Z",
    refundedAt: "2026-04-14T10:05:00.000Z",
    reasonLabel: null,
  },
  {
    id: "pi_3TMjukLApR7pSYE95vWxYz90",
    amountMinor: 3300,
    currency: "EUR",
    status: "disputed",
    paymentMethodLast4: "4242",
    description: "Suscripción abril",
    customer: "Beta Labs",
    createdAt: "2026-04-13T16:20:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
  {
    id: "pi_3TMjulLApR7pSYE96yZaBc12",
    amountMinor: 100,
    currency: "EUR",
    status: "error",
    paymentMethodLast4: "0002",
    description: "pi_3TMjulLApR7pSYE96yZaBc12",
    customer: null,
    createdAt: "2026-04-13T08:00:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
  {
    id: "pi_3TMjumLApR7pSYE97bCdEf34",
    amountMinor: 7777,
    currency: "USD",
    status: "succeeded",
    paymentMethodLast4: "4242",
    description: "(created by PSP CLI)",
    customer: null,
    createdAt: "2026-04-12T22:15:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
  {
    id: "pi_3TMjunLApR7pSYE98eFgHi56",
    amountMinor: 2500,
    currency: "EUR",
    status: "incomplete",
    paymentMethodLast4: null,
    description: "Checkout abandonado",
    customer: null,
    createdAt: "2026-04-12T12:00:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
  {
    id: "pi_3TMjuoLApR7pSYE99hIjKl78",
    amountMinor: 99900,
    currency: "USD",
    status: "succeeded",
    paymentMethodLast4: "4242",
    description: "pi_3TMjuoLApR7pSYE99hIjKl78",
    customer: "Globex",
    createdAt: "2026-04-11T19:33:00.000Z",
    refundedAt: null,
    reasonLabel: "Enviar recibo",
  },
  {
    id: "pi_3TMjupLApR7pSYE90mNoPq12",
    amountMinor: 450,
    currency: "EUR",
    status: "not_captured",
    paymentMethodLast4: "4242",
    description: "(created by PSP CLI)",
    customer: null,
    createdAt: "2026-04-11T07:07:00.000Z",
    refundedAt: null,
    reasonLabel: null,
  },
];

/** 33 filas para paginación “1-20 de 33”. */
export function buildInitialDemoTransactions(): DemoTransaction[] {
  const out: DemoTransaction[] = [...BASE];
  for (let i = out.length; i < 33; i += 1) {
    const src = BASE[i % BASE.length];
    out.push({
      ...src,
      id: `pi_demo_${i.toString(36)}${src.id.slice(-10)}`,
      createdAt: new Date(Date.UTC(2026, 3, 20 - (i % 18), 10 + (i % 8), (i * 7) % 60)).toISOString(),
    });
  }
  return out;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

export function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getDate();
  const mon = MONTHS[d.getMonth()];
  const h = d.getHours();
  const min = d.getMinutes();
  return `${day} ${mon} ${h}:${min.toString().padStart(2, "0")}`;
}

export function formatDemoAmount(row: DemoTransaction): string {
  const major = row.amountMinor / 100;
  const num = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
  if (row.currency === "EUR") return `${num} € EUR`;
  return `${num} US$ USD`;
}

export type SummaryCardKey =
  | "all"
  | "succeeded"
  | "refunded"
  | "disputed"
  | "error"
  | "not_captured";

export function countBySummary(rows: DemoTransaction[], key: SummaryCardKey): number {
  if (key === "all") return rows.length;
  return rows.filter((r) => {
    if (key === "succeeded") return r.status === "succeeded";
    if (key === "refunded") return r.status === "refunded";
    if (key === "disputed") return r.status === "disputed";
    if (key === "error") return r.status === "error";
    if (key === "not_captured") return r.status === "not_captured";
    return false;
  }).length;
}
