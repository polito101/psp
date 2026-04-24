"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMerchantPaymentMethods, patchMerchantPaymentMethod } from "@/lib/api/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

export function MerchantPaymentMethodsDashboard({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["merchant-payment-methods", merchantId],
    queryFn: () => fetchMerchantPaymentMethods(merchantId),
    staleTime: 20_000,
  });

  const patchMutation = useMutation({
    mutationFn: (args: { mpmId: string; body: { merchantEnabled: boolean } }) =>
      patchMerchantPaymentMethod(merchantId, args.mpmId, args.body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["merchant-payment-methods", merchantId] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Métodos de pago</h1>
        <p className="mt-1 text-sm text-slate-600">Kill switch a nivel comercio (merchant enabled).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuración</CardTitle>
          <CardDescription>Proveedor mock y catálogo interno</CardDescription>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : listQuery.isError ? (
            <p className="text-sm text-rose-700">{(listQuery.error as Error).message}</p>
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    <TH>Código</TH>
                    <TH>Label</TH>
                    <TH>Merchant ON</TH>
                    <TH>Admin ON</TH>
                  </tr>
                </THead>
                <TBody>
                  {(listQuery.data ?? []).map((row) => (
                    <tr key={row.id}>
                      <TD className="font-mono text-xs">{row.definition?.code ?? row.definitionId}</TD>
                      <TD>{row.definition?.label ?? "—"}</TD>
                      <TD>
                        <Checkbox
                          checked={row.merchantEnabled}
                          disabled={patchMutation.isPending || !row.adminEnabled}
                          onChange={() => {
                            patchMutation.mutate({ mpmId: row.id, body: { merchantEnabled: !row.merchantEnabled } });
                          }}
                          aria-label="Habilitado por merchant"
                        />
                      </TD>
                      <TD>{row.adminEnabled ? "sí" : "no"}</TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
