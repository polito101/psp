"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { approveSettlementRequest, fetchSettlementInbox, rejectSettlementRequest } from "@/lib/api/client";
import type { SettlementRequestRow } from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettlementInboxDashboard() {
  const qc = useQueryClient();
  const [flash, setFlash] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<{
    row: SettlementRequestRow;
    action: "approve" | "reject";
  } | null>(null);
  const [reviewedNotes, setReviewedNotes] = useState("");

  const inboxQuery = useQuery({
    queryKey: ["settlement-inbox"],
    queryFn: () => fetchSettlementInbox({ status: "PENDING" }),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });

  const approveMut = useMutation({
    mutationFn: (args: { row: SettlementRequestRow; reviewedNotes?: string }) =>
      approveSettlementRequest(args.row.id, { reviewedNotes: args.reviewedNotes }),
    onSuccess: async () => {
      setFlash("Aprobado y payout encolado.");
      setPendingReview(null);
      setReviewedNotes("");
      await qc.invalidateQueries({ queryKey: ["settlement-inbox"] });
    },
    onError: (e: Error) => setFlash(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (args: { row: SettlementRequestRow; reviewedNotes?: string }) =>
      rejectSettlementRequest(args.row.id, {
        reviewedNotes: args.reviewedNotes?.trim() || "Rechazado desde inbox",
      }),
    onSuccess: async () => {
      setFlash("Solicitud rechazada.");
      setPendingReview(null);
      setReviewedNotes("");
      await qc.invalidateQueries({ queryKey: ["settlement-inbox"] });
    },
    onError: (e: Error) => setFlash(e.message),
  });

  const busy = approveMut.isPending || rejectMut.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Operaciones · Liquidaciones</h1>
        <p className="mt-1 text-sm text-slate-600">Bandeja PENDING de solicitudes de settlement.</p>
      </div>

      {flash ? (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">{flash}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inbox</CardTitle>
          <CardDescription>Solo administradores</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {inboxQuery.isLoading ? (
            <p className="text-slate-500">Cargando…</p>
          ) : inboxQuery.isError ? (
            <p className="text-rose-700">{(inboxQuery.error as Error).message}</p>
          ) : (
            (inboxQuery.data?.items ?? []).map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
              >
                <div>
                  <p className="font-mono text-xs text-slate-600">{r.id}</p>
                  <p className="text-slate-800">
                    Merchant <span className="font-medium">{r.merchantId}</span> · {r.currency}{" "}
                    <span className="tabular-nums">{r.requestedNetMinor}</span> minor
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setFlash(null);
                      setPendingReview({ row: r, action: "reject" });
                      setReviewedNotes("");
                    }}
                  >
                    Rechazar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setFlash(null);
                      setPendingReview({ row: r, action: "approve" });
                      setReviewedNotes("");
                    }}
                  >
                    Aprobar
                  </Button>
                </div>
              </div>
            ))
          )}
          {!inboxQuery.isLoading && (inboxQuery.data?.items?.length ?? 0) === 0 ? (
            <p className="text-slate-500">No hay solicitudes pendientes.</p>
          ) : null}
        </CardContent>
      </Card>

      {pendingReview ? (
        <Card className="border-slate-300">
          <CardHeader>
            <CardTitle className="text-base">
              {pendingReview.action === "approve" ? "Confirmar aprobación" : "Confirmar rechazo"}
            </CardTitle>
            <CardDescription>
              Solicitud {pendingReview.row.id} · {pendingReview.row.currency}{" "}
              {pendingReview.row.requestedNetMinor} minor
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              value={reviewedNotes}
              onChange={(e) => setReviewedNotes(e.target.value)}
              rows={3}
              maxLength={500}
              className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
              placeholder="Nota visible en revisión operativa (opcional al aprobar)"
              aria-label="Notas de revisión operativa"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setPendingReview(null);
                  setReviewedNotes("");
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (pendingReview.action === "approve") {
                    approveMut.mutate({
                      row: pendingReview.row,
                      reviewedNotes: reviewedNotes.trim() || undefined,
                    });
                  } else {
                    rejectMut.mutate({
                      row: pendingReview.row,
                      reviewedNotes: reviewedNotes.trim() || undefined,
                    });
                  }
                }}
              >
                Confirmar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
