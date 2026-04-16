import { Check, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TransactionStatus } from "@/lib/api/contracts";

const LABELS: Record<TransactionStatus, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  requires_action: "Requiere acción",
  authorized: "Autorizado",
  succeeded: "Exitoso",
  failed: "Error",
  canceled: "Cancelado",
  refunded: "Reembolsado",
};

type StyleKey = "blue" | "green" | "gray" | "rose";

const STATUS_STYLE: Record<TransactionStatus, StyleKey> = {
  refunded: "blue",
  pending: "gray",
  processing: "gray",
  requires_action: "gray",
  authorized: "gray",
  succeeded: "green",
  failed: "rose",
  canceled: "rose",
};

const BOX: Record<StyleKey, string> = {
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  gray: "border-slate-200 bg-slate-100 text-slate-700",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
};

function IconFor({ status }: { status: TransactionStatus }) {
  if (status === "succeeded") return <Check className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />;
  return <Clock3 className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />;
}

export function StatusBadge({ status }: { status: TransactionStatus }) {
  const sk = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        BOX[sk],
      )}
    >
      <IconFor status={status} />
      {LABELS[status]}
    </span>
  );
}
