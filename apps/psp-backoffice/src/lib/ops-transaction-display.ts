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

export function formatAmountMinor(amountMinor: number, currency: string): string {
  const code = currency?.length === 3 ? currency.toUpperCase() : "EUR";
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: code,
    }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}

export { formatShortDateTime };
