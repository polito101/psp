"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPaymentProvider,
  fetchPaymentProviders,
  patchPaymentProvider,
} from "@/lib/api/client";
import type { PaymentProviderConfigRow } from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

function boolLabel(v: boolean): string {
  return v ? "Sí" : "No";
}

export function PaymentProvidersDashboard() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    integrationBaseUrl: "",
    initPaymentResource: "",
  });
  const [note, setNote] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["payment-providers"],
    queryFn: fetchPaymentProviders,
    staleTime: 15_000,
  });

  const create = useMutation({
    mutationFn: () =>
      createPaymentProvider({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        integrationBaseUrl: form.integrationBaseUrl.trim(),
        initPaymentResource: form.initPaymentResource.trim(),
      }),
    onSuccess: async () => {
      setNote("Proveedor creado.");
      setCreateOpen(false);
      setForm({ name: "", description: "", integrationBaseUrl: "", initPaymentResource: "" });
      await qc.invalidateQueries({ queryKey: ["payment-providers"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const patchFlags = useMutation({
    mutationFn: (args: { id: string; body: Record<string, boolean> }) =>
      patchPaymentProvider(args.id, args.body),
    onSuccess: async () => {
      setNote("Actualizado.");
      await qc.invalidateQueries({ queryKey: ["payment-providers"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Proveedores de pago</h1>
          <p className="mt-1 text-sm text-slate-600">Configuración global (psp-api v2).</p>
        </div>
        <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
          Nuevo proveedor
        </Button>
      </div>

      {note ? <p className="text-sm text-slate-700">{note}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listado</CardTitle>
          <CardDescription>Nombre, URL base, recurso de init y flags operativos.</CardDescription>
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
                    <TH>URL base</TH>
                    <TH>Recurso init</TH>
                    <TH>Configurado</TH>
                    <TH>Activo</TH>
                    <TH>Publicado</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((p: PaymentProviderConfigRow) => (
                    <tr key={p.id}>
                      <TD className="font-medium text-slate-900">{p.name}</TD>
                      <TD className="max-w-[200px] truncate text-xs font-mono text-slate-600" title={p.integrationBaseUrl}>
                        {p.integrationBaseUrl}
                      </TD>
                      <TD className="max-w-[180px] truncate text-xs font-mono text-slate-600" title={p.initPaymentResource}>
                        {p.initPaymentResource}
                      </TD>
                      <TD>
                        <ToggleCell
                          ariaLabel="Configurado"
                          value={p.isConfigured}
                          disabled={patchFlags.isPending}
                          onToggle={() =>
                            patchFlags.mutate({ id: p.id, body: { isConfigured: !p.isConfigured } })
                          }
                        />
                        <span className="ml-2 text-sm">{boolLabel(p.isConfigured)}</span>
                      </TD>
                      <TD>
                        <ToggleCell
                          ariaLabel="Activo"
                          value={p.isActive}
                          disabled={patchFlags.isPending}
                          onToggle={() => patchFlags.mutate({ id: p.id, body: { isActive: !p.isActive } })}
                        />
                        <span className="ml-2 text-sm">{boolLabel(p.isActive)}</span>
                      </TD>
                      <TD>
                        <ToggleCell
                          ariaLabel="Publicado"
                          value={p.isPublished}
                          disabled={patchFlags.isPending}
                          onToggle={() =>
                            patchFlags.mutate({ id: p.id, body: { isPublished: !p.isPublished } })
                          }
                        />
                        <span className="ml-2 text-sm">{boolLabel(p.isPublished)}</span>
                      </TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => !o && setCreateOpen(false)}
        title="Nuevo proveedor"
        description="Los cambios se persisten vía API de configuración."
      >
        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Nombre</span>
            <Input
              className="mt-1"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Descripción (opcional)</span>
            <Input
              className="mt-1"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">URL base de integración</span>
            <Input
              className="mt-1"
              value={form.integrationBaseUrl}
              onChange={(e) => setForm((f) => ({ ...f, integrationBaseUrl: e.target.value }))}
              placeholder="https://…"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-slate-600">Recurso init (path)</span>
            <Input
              className="mt-1"
              value={form.initPaymentResource}
              onChange={(e) => setForm((f) => ({ ...f, initPaymentResource: e.target.value }))}
              placeholder="/api/…"
            />
          </label>
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="primary"
              disabled={create.isPending}
              onClick={() => create.mutate()}
            >
              Guardar
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      </Dialog>

      <p className="text-sm">
        <Link href="/payment-methods" className="font-medium text-[var(--primary)] hover:underline">
          Ir a métodos de pago (rutas)
        </Link>
      </p>
    </div>
  );
}

function ToggleCell({
  value,
  onToggle,
  disabled,
  ariaLabel,
}: {
  value: boolean;
  onToggle: () => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={value}
      onClick={onToggle}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 rounded-full border border-slate-200 p-0.5 transition",
        value ? "bg-[var(--primary)]" : "bg-slate-200",
      )}
    >
      <span
        className={cn(
          "block h-5 w-5 rounded-full bg-white shadow transition",
          value ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
