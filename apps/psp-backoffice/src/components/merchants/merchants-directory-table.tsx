"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchMerchantsOpsDirectory } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

export function MerchantsDirectoryTable() {
  const q = useQuery({
    queryKey: ["merchants-ops-directory"],
    queryFn: () => fetchMerchantsOpsDirectory(),
    staleTime: 20_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Merchants</h1>
        <p className="mt-1 text-sm text-slate-600">Directorio operativo (interno).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listado</CardTitle>
          <CardDescription>Hasta 500 merchants recientes</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : q.isError ? (
            <p className="text-sm text-rose-700">{(q.error as Error).message}</p>
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    <TH>Nombre</TH>
                    <TH>Estado</TH>
                    <TH>Creado</TH>
                    <TH />
                  </tr>
                </THead>
                <TBody>
                  {(q.data ?? []).map((m) => (
                    <tr key={m.id}>
                      <TD className="font-medium text-slate-900">{m.name}</TD>
                      <TD>{m.isActive ? "activo" : "inactivo"}</TD>
                      <TD className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleString()}</TD>
                      <TD>
                        <Link
                          className="text-sm font-medium text-[var(--primary)] hover:underline"
                          href={`/merchants/${encodeURIComponent(m.id)}/overview`}
                        >
                          Ver
                        </Link>
                        {" · "}
                        <Link
                          className="text-sm font-medium text-[var(--primary)] hover:underline"
                          href={`/merchants/${encodeURIComponent(m.id)}/admin`}
                        >
                          Admin
                        </Link>
                      </TD>
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
