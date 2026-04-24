"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchMerchantsOpsDetail,
  patchMerchantOpsActive,
  patchMerchantPaymentMethod,
} from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export function MerchantAdminPanel({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["merchant-ops-detail-admin", merchantId],
    queryFn: () => fetchMerchantsOpsDetail(merchantId),
    staleTime: 15_000,
  });

  const toggleActive = useMutation({
    mutationFn: (isActive: boolean) => patchMerchantOpsActive(merchantId, { isActive }),
    onSuccess: async () => {
      setNote("Estado actualizado.");
      await qc.invalidateQueries({ queryKey: ["merchant-ops-detail-admin", merchantId] });
      await qc.invalidateQueries({ queryKey: ["merchants-ops-directory"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const patchMethod = useMutation({
    mutationFn: (args: { mpmId: string; adminEnabled: boolean }) =>
      patchMerchantPaymentMethod(merchantId, args.mpmId, {
        adminEnabled: args.adminEnabled,
        lastChangedBy: "admin:backoffice",
      }),
    onSuccess: async () => {
      setNote("Método actualizado.");
      await qc.invalidateQueries({ queryKey: ["merchant-ops-detail-admin", merchantId] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const m = detailQuery.data?.merchant;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin merchant</h1>
        <p className="mt-1 text-sm text-slate-600">{m?.name ?? merchantId}</p>
      </div>

      {note ? <p className="text-sm text-slate-700">{note}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cuenta</CardTitle>
          <CardDescription>Activar / desactivar comercio</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <p className="text-sm">
            Estado actual: <span className="font-semibold">{m?.isActive === false ? "inactivo" : "activo"}</span>
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={toggleActive.isPending || detailQuery.isLoading || !m}
            onClick={() => {
              if (!m) return;
              toggleActive.mutate(!m.isActive);
            }}
          >
            {m?.isActive === false ? "Activar" : "Desactivar"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Métodos (admin enabled)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {(detailQuery.data?.paymentMethods ?? []).map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded border border-slate-100 px-3 py-2">
              <span>
                {row.definition?.code} — {row.definition?.label}
              </span>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Admin ON
                <Checkbox
                  checked={row.adminEnabled}
                  disabled={patchMethod.isPending}
                  onChange={() => {
                    patchMethod.mutate({ mpmId: row.id, adminEnabled: !row.adminEnabled });
                  }}
                />
              </label>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
