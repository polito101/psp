"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { fetchOpsPaymentDetail, resendPaymentNotification } from "@/lib/api/client";
import type { OpsPaymentAttemptDetail, TransactionStatus } from "@/lib/api/contracts";
import { extractPaymentMethodLast4, formatAmountMinor } from "@/lib/ops-transaction-display";
import { formatShortDateTime } from "@/lib/transactions-demo-data";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

const OPERATION_LABELS_ES: Record<string, string> = {
  create: "Crear intento de pago",
  capture: "Capturar cargo",
  cancel: "Cancelar",
  refund: "Reembolso",
};

function providerDisplayName(selected: string | null | undefined): string {
  if (!selected) return "—";
  if (selected === "mock") return "Mock";
  if (selected === "acme") return "Acme";
  return selected;
}

function fundsAvailableLabel(detail: {
  status: string;
  succeededAt: string | null;
  updatedAt: string;
}): string {
  if (detail.succeededAt) {
    return formatFundsDateTime(detail.succeededAt);
  }
  if (detail.status === "succeeded" || detail.status === "refunded") {
    return formatFundsDateTime(detail.updatedAt);
  }
  return "—";
}

function formatFundsDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "—";
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function paymentDisplayId(providerRef: string | null, internalId: string): string {
  return providerRef?.trim() || internalId;
}

function attemptTitle(a: OpsPaymentAttemptDetail): string {
  const op = OPERATION_LABELS_ES[a.operation] ?? a.operation;
  return `${op} · ${a.provider}`;
}

type Props = { paymentId: string };

type DetailTab = "details" | "notifications" | "logs";

function JsonPre({ value }: { value: unknown }) {
  const text = JSON.stringify(value ?? null, null, 2);
  return (
    <pre className="mt-2 max-h-64 overflow-x-auto overflow-y-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
      {text}
    </pre>
  );
}

export function PaymentDetailView({ paymentId }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("details");

  const query = useQuery({
    queryKey: ["ops-payment-detail", paymentId],
    queryFn: () => fetchOpsPaymentDetail(paymentId),
  });

  const resendMut = useMutation({
    mutationFn: (deliveryId: string) => resendPaymentNotification(paymentId, deliveryId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["ops-payment-detail", paymentId] });
    },
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-sm text-slate-500">Cargando pago…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Link
          href="/transactions"
          className={cn(
            "mb-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 hover:bg-slate-50",
          )}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Volver
        </Link>
        <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {(query.error as Error).message}
        </div>
      </div>
    );
  }

  const d = query.data;
  if (!d) {
    return null;
  }

  const p = d.payment;
  const status = p.status as TransactionStatus;
  const last4 = extractPaymentMethodLast4(p.providerRef);
  const descriptionPrimary =
    p.idempotencyKey?.trim() || p.paymentLinkId?.trim() || p.id;
  const statementLine = p.merchantName?.trim() || "—";
  const methodLine = last4 ? `•••• ${last4}` : "—";

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/transactions"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Transacciones
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {(
          [
            ["details", "Detalles"],
            ["notifications", "Notificaciones"],
            ["logs", "Logs proveedor"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold tracking-tight text-slate-900">
          {formatAmountMinor(p.amountMinor, p.currency)}
        </span>
        <StatusBadge status={status} />
      </div>

      {tab === "details" ? (
        <>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Actividad del pago</h2>
              {p.attemptsTruncated ? (
                <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  Historial acotado: se muestran los {p.attempts.length} intentos más recientes de{" "}
                  <span className="font-semibold">{p.attemptsTotal}</span> en total.
                </p>
              ) : null}
              {p.attempts.length === 0 ? (
                <p className="text-sm text-slate-500">Sin intentos registrados en proveedor.</p>
              ) : (
                <ol className="ml-1 space-y-0 border-l border-[#e3e8ee] pl-6">
                  {p.attempts.map((a) => (
                    <li key={a.id} className="relative pb-8 last:pb-0">
                      <span
                        className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-white bg-[var(--primary)] shadow-sm"
                        aria-hidden
                      />
                      <p className="text-sm font-medium text-slate-900">{attemptTitle(a)}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{formatShortDateTime(a.createdAt)}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Estado intento: <span className="font-mono">{a.status}</span>
                        {a.latencyMs != null ? (
                          <span className="text-slate-400"> · {a.latencyMs} ms</span>
                        ) : null}
                      </p>
                      {a.providerPaymentId ? (
                        <p className="mt-1 font-mono text-xs text-slate-600">Ref: {a.providerPaymentId}</p>
                      ) : null}
                      {a.errorMessage ? (
                        <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800">
                          {a.errorMessage}
                        </p>
                      ) : null}
                      {"responsePayload" in a && a.responsePayload !== undefined ? (
                        <>
                          <p className="mt-2 text-xs font-medium text-slate-500">responsePayload</p>
                          <JsonPre value={a.responsePayload} />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {d.action != null ? (
                <div className="mt-8">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Acción persistida</h3>
                  <JsonPre value={d.action} />
                </div>
              ) : null}
            </section>

            <aside className="rounded-xl border border-[#e3e8ee] bg-slate-50/40 p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-slate-900">Detalles</h2>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="text-xs font-medium text-slate-500">ID de pago</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-slate-800">
                    {paymentDisplayId(p.providerRef, p.id)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Método de pago</dt>
                  <dd className="mt-1 text-slate-800">{methodLine}</dd>
                </div>
                <div>
                  <dt className="flex items-baseline justify-between gap-2 text-xs font-medium text-slate-500">
                    <span>Descripción</span>
                    <button
                      type="button"
                      className="cursor-not-allowed text-[11px] font-normal text-slate-400"
                      disabled
                      title="La edición de descripción no está disponible en el backoffice"
                    >
                      Editar
                    </button>
                  </dt>
                  <dd className="mt-1 break-words text-slate-800">{descriptionPrimary}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Descripción del cargo en el extracto bancario</dt>
                  <dd className="mt-1 break-words text-slate-800">{statementLine}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Proveedor</dt>
                  <dd className="mt-1 text-slate-800">{providerDisplayName(p.selectedProvider)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Fondos disponibles</dt>
                  <dd className="mt-1 text-slate-800">{fundsAvailableLabel(p)}</dd>
                </div>
                <div>
                  <Link href="/transactions" className="text-sm font-medium text-[var(--primary)] hover:underline">
                    Ver transacciones
                  </Link>
                </div>
                <div>
                  <Link
                    href={`/merchants/${encodeURIComponent(p.merchantId)}/finance`}
                    className="text-sm font-medium text-[var(--primary)] hover:underline"
                  >
                    Finanzas del merchant
                  </Link>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Última actualización</dt>
                  <dd className="mt-1 text-slate-800">{formatShortDateTime(p.updatedAt)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </>
      ) : null}

      {tab === "notifications" ? (
        <section className="min-w-0">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Notificaciones al comercio</h2>
          {d.notificationDeliveries.length === 0 ? (
            <p className="text-sm text-slate-500">Sin entregas registradas.</p>
          ) : (
            <div className="space-y-6">
              {d.notificationDeliveries.map((n) => (
                <div
                  key={n.id}
                  className="rounded-xl border border-[#e3e8ee] bg-white p-4 shadow-sm dark:bg-slate-950/20"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-xs text-slate-500">{n.id}</p>
                      <p className="mt-1 text-sm text-slate-800">
                        {formatShortDateTime(n.createdAt)} · intento {n.attemptNo} · {n.statusSnapshot}
                        {n.httpStatus != null ? ` · HTTP ${n.httpStatus}` : ""}
                        {n.isResend ? " · reenvío" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => resendMut.mutate(n.id)}
                      disabled={resendMut.isPending}
                      className={cn(
                        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50",
                      )}
                    >
                      {resendMut.isPending && resendMut.variables === n.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Reenviar
                    </button>
                  </div>
                  <p className="mt-3 text-xs font-medium text-slate-500">requestBodyMasked</p>
                  <JsonPre value={n.requestBodyMasked} />
                  <p className="mt-2 text-xs font-medium text-slate-500">responseBodyMasked</p>
                  <JsonPre value={n.responseBodyMasked} />
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "logs" ? (
        <section className="min-w-0">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Logs de proveedor</h2>
          {d.providerLogs.length === 0 ? (
            <p className="text-sm text-slate-500">Sin logs de proveedor para este pago.</p>
          ) : (
            <div className="space-y-6">
              {d.providerLogs.map((log) => (
                <div key={log.id} className="rounded-xl border border-[#e3e8ee] bg-white p-4 shadow-sm">
                  <p className="break-all font-mono text-xs text-slate-500">{log.id}</p>
                  <p className="mt-1 text-sm text-slate-800">
                    {formatShortDateTime(log.createdAt)} · {log.operation}
                    {log.httpStatus != null ? ` · HTTP ${log.httpStatus}` : ""}
                    {log.latencyMs != null ? ` · ${log.latencyMs} ms` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    provider <span className="font-mono">{log.providerId}</span> · route{" "}
                    <span className="font-mono">{log.routeId}</span>
                    {log.providerTransactionId ? (
                      <>
                        {" "}
                        · ref <span className="font-mono">{log.providerTransactionId}</span>
                      </>
                    ) : null}
                  </p>
                  {log.errorMessage ? (
                    <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-800">{log.errorMessage}</p>
                  ) : null}
                  <p className="mt-3 text-xs font-medium text-slate-500">requestMasked</p>
                  <JsonPre value={log.requestMasked} />
                  <p className="mt-2 text-xs font-medium text-slate-500">responseMasked</p>
                  <JsonPre value={log.responseMasked} />
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
