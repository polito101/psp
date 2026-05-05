"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPaymentMethodRoutes, fetchPaymentProviders } from "@/lib/api/client";
import type { PaymentMethodRouteRow, PaymentProviderConfigRow } from "@/lib/api/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui/table";

type StatusFilter = "all" | "active" | "inactive" | "published" | "draft";

function routeStatusLabel(r: PaymentMethodRouteRow): string {
  if (!r.isActive) return "Inactivo";
  if (r.isPublished) return "Activo · publicado";
  return "Activo · borrador";
}

function currenciesCell(r: PaymentMethodRouteRow): string {
  return r.currencies.map((c) => c.currency).join(", ") || "—";
}

export function PaymentMethodRoutesDashboard() {
  const [countryCode, setCountryCode] = useState("");
  const [providerId, setProviderId] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const providersQuery = useQuery({
    queryKey: ["payment-providers"],
    queryFn: fetchPaymentProviders,
    staleTime: 60_000,
  });

  const apiFilters = useMemo(() => {
    const f: Parameters<typeof fetchPaymentMethodRoutes>[0] = {};
    const cc = countryCode.trim().toUpperCase();
    if (cc.length === 2) f.countryCode = cc;
    const pid = providerId.trim();
    if (pid) f.providerId = pid;
    if (channel === "CASH" || channel === "ONLINE" || channel === "CREDIT_CARD" || channel === "CRYPTO") {
      f.channel = channel;
    }
    if (statusFilter === "active") f.isActive = true;
    if (statusFilter === "inactive") f.isActive = false;
    return f;
  }, [countryCode, providerId, channel, statusFilter]);

  const routesQuery = useQuery({
    queryKey: ["payment-method-routes", apiFilters],
    queryFn: () => fetchPaymentMethodRoutes(apiFilters),
    staleTime: 10_000,
  });

  const rows = useMemo(() => {
    const list = routesQuery.data ?? [];
    if (statusFilter === "published") {
      return list.filter((r) => r.isPublished);
    }
    if (statusFilter === "draft") {
      return list.filter((r) => r.isActive && !r.isPublished);
    }
    return list;
  }, [routesQuery.data, statusFilter]);

  const providers = providersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Métodos de pago (rutas)</h1>
          <p className="mt-1 text-sm text-slate-600">Rutas ponderadas por proveedor, país y canal.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/payment-methods/weights"
            className="inline-flex h-9 items-center justify-center rounded-md bg-slate-100 px-4 text-sm font-medium text-slate-800 hover:bg-slate-200"
          >
            Pesos por grupo
          </Link>
          <Link
            href="/payment-methods/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-white hover:bg-[#5248e6]"
          >
            Nueva ruta
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>País y proveedor se envían a la API; publicado/borrador se refinan en cliente.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <label className="min-w-[140px] text-sm">
            <span className="text-xs font-medium text-slate-600">País (ISO2)</span>
            <Input
              className="mt-1 uppercase"
              value={countryCode}
              maxLength={2}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              placeholder="MX"
            />
          </label>
          <label className="min-w-[200px] text-sm">
            <span className="text-xs font-medium text-slate-600">Proveedor</span>
            <Select
              className="mt-1"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              <option value="">Todos</option>
              {providers.map((p: PaymentProviderConfigRow) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-[160px] text-sm">
            <span className="text-xs font-medium text-slate-600">Canal</span>
            <Select className="mt-1" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">Todos</option>
              <option value="CASH">CASH</option>
              <option value="ONLINE">ONLINE</option>
              <option value="CREDIT_CARD">CREDIT_CARD</option>
              <option value="CRYPTO">CRYPTO</option>
            </Select>
          </label>
          <label className="min-w-[200px] text-sm">
            <span className="text-xs font-medium text-slate-600">Estado</span>
            <Select
              className="mt-1"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">Todos</option>
              <option value="active">Activos (API)</option>
              <option value="inactive">Inactivos (API)</option>
              <option value="published">Publicados (local)</option>
              <option value="draft">Borrador activo (local)</option>
            </Select>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rutas</CardTitle>
          <CardDescription>{rows.length} filas (tras filtros)</CardDescription>
        </CardHeader>
        <CardContent>
          {routesQuery.isLoading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : routesQuery.isError ? (
            <p className="text-sm text-rose-700">{(routesQuery.error as Error).message}</p>
          ) : (
            <TableContainer>
              <Table>
                <THead>
                  <tr>
                    <TH>UID</TH>
                    <TH>Plantilla checkout</TH>
                    <TH>Nombre</TH>
                    <TH>País</TH>
                    <TH>Canal</TH>
                    <TH>Proveedor</TH>
                    <TH>Código</TH>
                    <TH>Monedas</TH>
                    <TH>Peso</TH>
                    <TH>Estado</TH>
                    <TH />
                  </tr>
                </THead>
                <TBody>
                  {rows.map((r: PaymentMethodRouteRow) => (
                    <tr key={r.id}>
                      <TD className="font-mono text-xs">{r.id}</TD>
                      <TD className="max-w-[140px] truncate text-xs" title={r.checkoutUrlTemplate ?? ""}>
                        {r.checkoutUrlTemplate ?? "—"}
                      </TD>
                      <TD className="font-medium text-slate-900">{r.methodName}</TD>
                      <TD>{r.countryCode}</TD>
                      <TD>{r.channel}</TD>
                      <TD>{r.provider?.name ?? r.providerId}</TD>
                      <TD className="font-mono text-xs">{r.methodCode}</TD>
                      <TD className="text-xs">{currenciesCell(r)}</TD>
                      <TD>{r.weight}</TD>
                      <TD className="text-sm">{routeStatusLabel(r)}</TD>
                      <TD>
                        <Link
                          className="text-sm font-medium text-[var(--primary)] hover:underline"
                          href={`/payment-methods/${encodeURIComponent(r.id)}/edit`}
                        >
                          Editar
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
