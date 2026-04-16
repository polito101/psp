import type { OpsTransactionItem, TransactionStatus } from "@/lib/api/contracts";
import { formatShortDateTime } from "@/lib/transactions-demo-data";

export type TransactionTableRow = {
  id: string;
  amountMinor: number;
  currency: string;
  status: TransactionStatus;
  paymentMethodLast4: string | null;
  description: string;
  customer: string | null;
  createdAt: string;
  refundedAt: string | null;
  reasonLabel: string | null;
  raw: OpsTransactionItem;
};

/**
 * Heurística para mostrar últimos 4 dígitos / sufijo de método a partir de `providerRef` (Stripe u otros).
 */
export function extractPaymentMethodLast4(providerRef: string | null | undefined): string | null {
  const ref = providerRef ?? "";
  if (/^pm_|^card_|[0-9]{4}$/i.test(ref) && ref.length >= 4) {
    return ref.slice(-4);
  }
  return null;
}

/**
 * Convierte un ítem del endpoint ops/transactions a filas de la tabla del dashboard.
 * Campos no expuestos por la API (p. ej. PAN enmascarado) quedan en "—" o derivados heurísticos.
 */
export function mapOpsItemToTableRow(item: OpsTransactionItem): TransactionTableRow {
  const refundAttempt =
    item.lastAttempt?.operation === "refund" ? item.lastAttempt : null;
  const refundedAt =
    item.status === "refunded"
      ? refundAttempt?.createdAt ?? item.updatedAt ?? null
      : null;

  const last4FromRef = extractPaymentMethodLast4(item.providerRef);

  const reason =
    item.routingReasonCode?.trim() ||
    item.statusReason?.trim() ||
    (item.status === "refunded" ? "Reembolso" : null);

  return {
    id: item.id,
    amountMinor: item.amountMinor,
    currency: item.currency,
    status: item.status,
    paymentMethodLast4: last4FromRef,
    description: item.providerRef ?? item.id,
    customer: item.merchantName || null,
    createdAt: item.createdAt,
    refundedAt,
    reasonLabel: reason,
    raw: item,
  };
}

/**
 * Convierte unidades menores desde número, bigint o string decimal entero (p. ej. payload de `volume-hourly`).
 * Cadenas no numéricas enteras devuelven `0n` (defensivo para UI).
 */
export function amountMinorToBigInt(amountMinor: number | bigint | string): bigint {
  if (typeof amountMinor === "bigint") return amountMinor;
  if (typeof amountMinor === "string") {
    const t = amountMinor.trim();
    if (!/^-?\d+$/.test(t)) return 0n;
    return BigInt(t);
  }
  return BigInt(Math.trunc(amountMinor));
}

/**
 * Formatea importe en unidades menores (p. ej. céntimos) a moneda `es-ES`.
 * Acepta `string`/`bigint` para totales que pueden superar `Number.MAX_SAFE_INTEGER`.
 */
export function formatAmountMinor(amountMinor: number | bigint | string, currency: string): string {
  const code = currency?.length === 3 ? currency.toUpperCase() : "EUR";
  const minor = amountMinorToBigInt(amountMinor);
  const abs = minor < 0n ? -minor : minor;

  if (abs <= BigInt(Number.MAX_SAFE_INTEGER)) {
    const n = Number(minor) / 100;
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: code,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${code}`;
    }
  }

  const neg = minor < 0n;
  const euros = abs / 100n;
  const cents = abs % 100n;
  const grouped = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const base = `${neg ? "-" : ""}${grouped},${cents.toString().padStart(2, "0")}`;
  try {
    const sym = new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value;
    return sym ? `${base}\u00A0${sym}` : `${base} ${code}`;
  } catch {
    return `${base} ${code}`;
  }
}

export { formatShortDateTime };
