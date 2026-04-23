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

  const inboxQuery = useQuery({
    queryKey: ["settlement-inbox"],
    queryFn: () => fetchSettlementInbox({ status: "PENDING" }),
    staleTime: 10_000,
    refetchInterval: 20_000,
  });

  const approveMut = useMutation({
    mutationFn: (row: SettlementRequestRow) => approveSettlementRequest(row.id, {}),
    onSuccess: async () => {
      setFlash("Aprobado y payout encolado.");
      await qc.invalidateQueries({ queryKey: ["settlement-inbox"] });
    },
    onError: (e: Error) => setFlash(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (row: SettlementRequestRow) => rejectSettlementRequest(row.id, { reviewedNotes: "Rechazado desde inbox" }),
    onSuccess: async () => {
      setFlash("Solicitud rechazada.");
      await qc.invalidateQueries({ queryKey: ["settlement-inbox"] });
    },
    onError: (e: Error) => setFlash(e.message),
  });

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
                    disabled={rejectMut.isPending}
                    onClick={() => {
                      setFlash(null);
                      rejectMut.mutate(r);
                    }}
                  >
                    Rechazar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={approveMut.isPending}
                    onClick={() => {
                      setFlash(null);
                      approveMut.mutate(r);
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
    </div>
  );
}
