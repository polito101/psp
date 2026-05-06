"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPaymentMethodRoutes, patchPaymentMethodRouteWeight } from "@/lib/api/client";
import type { PaymentMethodRouteRow } from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

/** Clave estable para agrupar rutas que compiten por peso. */
export function routeWeightGroupKey(r: PaymentMethodRouteRow): string {
  return [r.methodCode, r.methodName, r.countryCode, r.channel].join("\u001f");
}

export function PaymentMethodWeightTab() {
  const qc = useQueryClient();
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["payment-method-routes", "weights"],
    queryFn: () => fetchPaymentMethodRoutes({}),
    staleTime: 10_000,
  });

  const groups = useMemo(() => {
    const list = q.data ?? [];
    const map = new Map<string, PaymentMethodRouteRow[]>();
    for (const r of list) {
      const k = routeWeightGroupKey(r);
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
    }
    return [...map.entries()].sort(([ka], [kb]) => ka.localeCompare(kb));
  }, [q.data]);

  const saveWeight = useMutation({
    mutationFn: (args: { routeId: string; weight: number }) =>
      patchPaymentMethodRouteWeight(args.routeId, args.weight),
    onSuccess: async () => {
      setNote("Peso guardado.");
      await qc.invalidateQueries({ queryKey: ["payment-method-routes"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  function weightInputValue(routeId: string, fallback: number): string {
    return weights[routeId] ?? String(fallback);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Pesos por grupo</h1>
        <p className="mt-1 text-sm text-slate-600">
          Misma combinación código + nombre + país + canal. Mayor peso = más probabilidad relativa.
        </p>
      </div>
      {note ? <p className="text-sm text-slate-700">{note}</p> : null}

      {q.isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : q.isError ? (
        <p className="text-sm text-rose-700">{(q.error as Error).message}</p>
      ) : (
        <div className="space-y-6">
          {groups.map(([key, routes]) => {
            const [code, name, country, channel] = key.split("\u001f");
            return (
              <Card key={key}>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-slate-900">
                    {code} · {name} · {country} · {channel}
                  </CardTitle>
                  <CardDescription>{routes.length} rutas en este grupo</CardDescription>
                </CardHeader>
                <CardContent>
                  <TableContainer>
                    <Table>
                      <THead>
                        <tr>
                          <TH>Ruta</TH>
                          <TH>Proveedor</TH>
                          <TH>Peso</TH>
                          <TH />
                        </tr>
                      </THead>
                      <TBody>
                        {routes.map((r) => (
                          <tr key={r.id}>
                            <TD className="font-mono text-xs">{r.id}</TD>
                            <TD>{r.provider?.name ?? r.providerId}</TD>
                            <TD>
                              <Input
                                className="w-24 font-mono text-sm"
                                value={weightInputValue(r.id, r.weight)}
                                onChange={(e) =>
                                  setWeights((prev) => ({ ...prev, [r.id]: e.target.value }))
                                }
                              />
                            </TD>
                            <TD>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={saveWeight.isPending}
                                onClick={() => {
                                  const raw = weightInputValue(r.id, r.weight);
                                  const n = Number.parseInt(raw, 10);
                                  if (!Number.isFinite(n)) {
                                    setNote("Peso inválido");
                                    return;
                                  }
                                  saveWeight.mutate({ routeId: r.id, weight: n });
                                }}
                              >
                                Guardar
                              </Button>
                            </TD>
                          </tr>
                        ))}
                      </TBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            );
          })}
          {groups.length === 0 ? <p className="text-sm text-slate-500">No hay rutas.</p> : null}
        </div>
      )}
    </div>
  );
}
