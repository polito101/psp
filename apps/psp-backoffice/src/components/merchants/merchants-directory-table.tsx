"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMerchantsOpsDirectory } from "@/lib/api/client";
import type { MerchantsOpsDirectoryRow } from "@/lib/api/contracts";
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

function normalizeMerchantSearch(s: string): string {
  return s.trim().toLowerCase();
}

function merchantMatchesSearch(row: MerchantsOpsDirectoryRow, needle: string): boolean {
  if (!needle) return true;
  const name = row.name.toLowerCase();
  const id = row.id.toLowerCase();
  return name.includes(needle) || id.includes(needle);
}

export function MerchantsDirectoryTable() {
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["merchants-ops-directory"],
    queryFn: () => fetchMerchantsOpsDirectory(),
    staleTime: 20_000,
  });

  const needle = useMemo(() => normalizeMerchantSearch(search), [search]);
  const rows = q.data ?? [];
  const filtered = useMemo(() => rows.filter((m) => merchantMatchesSearch(m, needle)), [rows, needle]);

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
            <>
              <div className="mb-4 max-w-md">
                <label htmlFor="merchants-directory-search" className="mb-1 block text-xs font-medium text-slate-600">
                  Buscar
                </label>
                <Input
                  id="merchants-directory-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre o ID del merchant"
                  autoComplete="off"
                  spellCheck={false}
                />
                {needle ? (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {filtered.length === 0
                      ? "Ningún resultado en las filas cargadas."
                      : `Mostrando ${filtered.length} de ${rows.length} merchants cargados.`}
                  </p>
                ) : null}
              </div>
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
                    {filtered.map((m) => (
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
