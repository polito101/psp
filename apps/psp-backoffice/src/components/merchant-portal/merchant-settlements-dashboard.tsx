"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createSettlementRequest, fetchSettlementAvailableBalance, fetchSettlementRequestsForMerchant } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function MerchantSettlementsDashboard({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const balanceQuery = useQuery({
    queryKey: ["settlement-balance", merchantId],
    queryFn: () => fetchSettlementAvailableBalance(merchantId, "EUR"),
    staleTime: 15_000,
  });

  const listQuery = useQuery({
    queryKey: ["settlement-requests", merchantId],
    queryFn: () => fetchSettlementRequestsForMerchant(merchantId),
    staleTime: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: () => createSettlementRequest(merchantId, { currency: "EUR" }),
    onSuccess: async () => {
      setMessage("Solicitud creada.");
      await qc.invalidateQueries({ queryKey: ["settlement-requests", merchantId] });
      await qc.invalidateQueries({ queryKey: ["settlement-balance", merchantId] });
    },
    onError: (e: Error) => {
      setMessage(e.message);
    },
  });

  const available = balanceQuery.data?.availableNetMinor ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Liquidaciones</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saldo neto AVAILABLE (EUR) y solicitudes manuales de payout.
        </p>
      </div>

      {message ? (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{message}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saldo disponible</CardTitle>
          <CardDescription>Neto en minor units sin payout asignado</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <p className="text-2xl font-semibold tabular-nums">
            {balanceQuery.isLoading ? "…" : available != null ? available : "—"}{" "}
            <span className="text-sm font-normal text-slate-500">minor EUR</span>
          </p>
          <Button
            type="button"
            disabled={createMutation.isPending || (available ?? 0) <= 0}
            onClick={() => {
              setMessage(null);
              createMutation.mutate();
            }}
          >
            {createMutation.isPending ? "Enviando…" : "Solicitar liquidación"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de solicitudes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {listQuery.isLoading ? (
            <p className="text-slate-500">Cargando…</p>
          ) : (
            (listQuery.data?.items ?? []).map((r) => (
              <div key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
                <span className="font-mono text-xs text-slate-600">{r.id.slice(0, 10)}…</span>
                <span className="font-medium">{r.status}</span>
                <span className="text-slate-500">
                  {r.currency} · {r.requestedNetMinor} minor
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
