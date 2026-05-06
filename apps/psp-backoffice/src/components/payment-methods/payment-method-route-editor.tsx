"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPaymentMethodRoute,
  fetchPaymentMethodRoutes,
  fetchPaymentProviders,
  patchPaymentMethodRoute,
} from "@/lib/api/client";
import type { PaymentProviderConfigRow } from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type CurrencyRow = { currency: string; minAmount: string; maxAmount: string; isDefault: boolean };

const CHANNELS = ["CASH", "ONLINE", "CREDIT_CARD", "CRYPTO"] as const;
const MODES = ["S2S", "REDIRECTION", "HOSTED_PAGE"] as const;
const TEMPLATES = ["REDIRECT_SIMPLE", "SPEI_BANK_TRANSFER"] as const;

function emptyCurrencyRow(): CurrencyRow {
  return { currency: "USD", minAmount: "1", maxAmount: "1000000", isDefault: true };
}

export function PaymentMethodRouteEditor({ routeId }: { routeId: string | null }) {
  const qc = useQueryClient();
  const isEdit = routeId != null;
  const [note, setNote] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ["payment-providers"],
    queryFn: fetchPaymentProviders,
    staleTime: 60_000,
  });

  const routesQuery = useQuery({
    queryKey: ["payment-method-routes", "editor-loader"],
    queryFn: () => fetchPaymentMethodRoutes({}),
    enabled: isEdit,
    staleTime: 5_000,
  });

  const existing = useMemo(() => {
    if (!routeId || !routesQuery.data) return undefined;
    return routesQuery.data.find((r) => r.id === routeId);
  }, [routeId, routesQuery.data]);

  const [providerId, setProviderId] = useState("");
  const [methodCode, setMethodCode] = useState("");
  const [methodName, setMethodName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [countryName, setCountryName] = useState("");
  const [countryImageName, setCountryImageName] = useState("");
  const [checkoutUrlTemplate, setCheckoutUrlTemplate] = useState("");
  const [expirationTimeOffset, setExpirationTimeOffset] = useState("0");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("ONLINE");
  const [integrationMode, setIntegrationMode] = useState<(typeof MODES)[number]>("REDIRECTION");
  const [requestTemplate, setRequestTemplate] = useState<(typeof TEMPLATES)[number]>("REDIRECT_SIMPLE");
  const [integrationCode, setIntegrationCode] = useState("");
  const [weight, setWeight] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [isPublished, setIsPublished] = useState(false);
  const [routeConfigText, setRouteConfigText] = useState("");
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([emptyCurrencyRow()]);

  useEffect(() => {
    if (!existing) return;
    // Sincronizar formulario al cargar la fila desde React Query (fuente externa → estado local).
    /* eslint-disable react-hooks/set-state-in-effect -- batch reset when `existing` arrives after fetch */
    setProviderId(existing.providerId);
    setMethodCode(existing.methodCode);
    setMethodName(existing.methodName);
    setCountryCode(existing.countryCode);
    setCountryName(existing.countryName ?? "");
    setCountryImageName(existing.countryImageName ?? "");
    setCheckoutUrlTemplate(existing.checkoutUrlTemplate ?? "");
    setExpirationTimeOffset(String(existing.expirationTimeOffset ?? 0));
    setChannel(existing.channel);
    setIntegrationMode(existing.integrationMode);
    setRequestTemplate(existing.requestTemplate);
    setIntegrationCode(existing.integrationCode ?? "");
    setWeight(String(existing.weight));
    setIsActive(existing.isActive);
    setIsPublished(existing.isPublished);
    setRouteConfigText(
      existing.routeConfigJson != null ? JSON.stringify(existing.routeConfigJson, null, 2) : "",
    );
    setCurrencies(
      existing.currencies.length
        ? existing.currencies.map((c) => ({
            currency: c.currency,
            minAmount: String(c.minAmount),
            maxAmount: String(c.maxAmount),
            isDefault: c.isDefault,
          }))
        : [emptyCurrencyRow()],
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [existing]);

  const createMut = useMutation({
    mutationFn: () => {
      let routeConfigJson: Record<string, unknown> | undefined;
      const t = routeConfigText.trim();
      if (t !== "") {
        try {
          routeConfigJson = JSON.parse(t) as Record<string, unknown>;
        } catch {
          throw new Error("JSON inválido en opciones");
        }
      }
      return createPaymentMethodRoute({
        providerId: providerId.trim(),
        methodCode: methodCode.trim(),
        methodName: methodName.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        countryName: countryName.trim() || undefined,
        countryImageName: countryImageName.trim() || undefined,
        channel,
        integrationMode,
        requestTemplate,
        integrationCode: integrationCode.trim() || undefined,
        checkoutUrlTemplate: checkoutUrlTemplate.trim() || undefined,
        expirationTimeOffset: Number.parseInt(expirationTimeOffset, 10) || 0,
        weight: Number.parseInt(weight, 10) || 0,
        isActive,
        isPublished,
        routeConfigJson,
        currencies: currencies.map((c) => ({
          currency: c.currency.trim().toUpperCase(),
          minAmount: Number(c.minAmount),
          maxAmount: Number(c.maxAmount),
          isDefault: c.isDefault,
        })),
      });
    },
    onSuccess: async () => {
      setNote("Ruta creada.");
      await qc.invalidateQueries({ queryKey: ["payment-method-routes"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const patchMut = useMutation({
    mutationFn: () => {
      const t = routeConfigText.trim();
      let routeConfigJson: Record<string, unknown> | undefined;
      if (t !== "") {
        try {
          routeConfigJson = JSON.parse(t) as Record<string, unknown>;
        } catch {
          throw new Error("JSON inválido en opciones");
        }
      }
      const body: Record<string, unknown> = {
        methodCode: methodCode.trim(),
        methodName: methodName.trim(),
        countryCode: countryCode.trim().toUpperCase(),
        countryName: countryName.trim() === "" ? null : countryName.trim(),
        countryImageName: countryImageName.trim() === "" ? null : countryImageName.trim(),
        channel,
        integrationMode,
        requestTemplate,
        integrationCode: integrationCode.trim() === "" ? null : integrationCode.trim(),
        checkoutUrlTemplate: checkoutUrlTemplate.trim() === "" ? null : checkoutUrlTemplate.trim(),
        expirationTimeOffset: Number.parseInt(expirationTimeOffset, 10) || 0,
        weight: Number.parseInt(weight, 10) || 0,
        isActive,
        isPublished,
        currencies: currencies.map((c) => ({
          currency: c.currency.trim().toUpperCase(),
          minAmount: Number(c.minAmount),
          maxAmount: Number(c.maxAmount),
          isDefault: c.isDefault,
        })),
      };
      if (routeConfigJson !== undefined) {
        body.routeConfigJson = routeConfigJson;
      }
      return patchPaymentMethodRoute(routeId!, body);
    },
    onSuccess: async () => {
      setNote("Ruta actualizada.");
      await qc.invalidateQueries({ queryKey: ["payment-method-routes"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  function onSubmit() {
    setNote(null);
    if (isEdit) {
      patchMut.mutate();
    } else {
      createMut.mutate();
    }
  }

  const providers = providersQuery.data ?? [];
  const loadingExisting = isEdit && routesQuery.isLoading;
  const missingExisting = isEdit && !routesQuery.isLoading && existing === undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {isEdit ? "Editar ruta" : "Nueva ruta"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          <Link href="/payment-methods" className="font-medium text-[var(--primary)] hover:underline">
            ← Volver al listado
          </Link>
        </p>
      </div>

      {note ? <p className="text-sm text-slate-700">{note}</p> : null}
      {loadingExisting ? <p className="text-sm text-slate-500">Cargando ruta…</p> : null}
      {missingExisting ? (
        <p className="text-sm text-rose-700">No se encontró la ruta solicitada.</p>
      ) : null}

      {!loadingExisting && !missingExisting ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Información general</CardTitle>
              <CardDescription>Código, nombre, país y plantilla de URL de checkout.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {!isEdit ? (
                <label className="text-sm">
                  <span className="text-xs font-medium text-slate-600">Proveedor</span>
                  <Select
                    className="mt-1"
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                  >
                    <option value="">Selecciona…</option>
                    {providers.map((p: PaymentProviderConfigRow) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : (
                <div className="text-sm">
                  <span className="text-xs font-medium text-slate-600">Proveedor (solo lectura)</span>
                  <p className="mt-1 font-medium">{existing?.provider?.name ?? providerId}</p>
                </div>
              )}
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">Código de método</span>
                <Input className="mt-1 font-mono text-sm" value={methodCode} onChange={(e) => setMethodCode(e.target.value)} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-xs font-medium text-slate-600">Nombre visible</span>
                <Input className="mt-1" value={methodName} onChange={(e) => setMethodName(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">País (ISO2)</span>
                <Input
                  className="mt-1 uppercase"
                  maxLength={2}
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">Nombre país (opcional)</span>
                <Input className="mt-1" value={countryName} onChange={(e) => setCountryName(e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">Imagen país (opcional)</span>
                <Input className="mt-1" value={countryImageName} onChange={(e) => setCountryImageName(e.target.value)} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-xs font-medium text-slate-600">Plantilla URL checkout (opcional)</span>
                <Input
                  className="mt-1 font-mono text-xs"
                  value={checkoutUrlTemplate}
                  onChange={(e) => setCheckoutUrlTemplate(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">Offset expiración (segundos)</span>
                <Input
                  className="mt-1"
                  value={expirationTimeOffset}
                  onChange={(e) => setExpirationTimeOffset(e.target.value)}
                />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clasificación</CardTitle>
              <CardDescription>Canal, modo de integración y plantilla de request.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">Canal</span>
                <Select className="mt-1" value={channel} onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">Modo integración</span>
                <Select
                  className="mt-1"
                  value={integrationMode}
                  onChange={(e) => setIntegrationMode(e.target.value as (typeof MODES)[number])}
                >
                  {MODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-xs font-medium text-slate-600">Plantilla de request</span>
                <Select
                  className="mt-1"
                  value={requestTemplate}
                  onChange={(e) => setRequestTemplate(e.target.value as (typeof TEMPLATES)[number])}
                >
                  {TEMPLATES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-xs font-medium text-slate-600">Código de integración (opcional)</span>
                <Input className="mt-1" value={integrationCode} onChange={(e) => setIntegrationCode(e.target.value)} />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ajustes de publicación</CardTitle>
              <CardDescription>Peso inicial (ajuste fino en pestaña de pesos).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                Activa
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
                Publicada
              </label>
              <label className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Peso</span>
                <Input className="w-24" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Capacidades y opciones</CardTitle>
              <CardDescription>JSON opaco para el adaptador (routeConfigJson).</CardDescription>
            </CardHeader>
            <CardContent>
              <label className="block text-sm">
                <span className="text-xs font-medium text-slate-600">Opciones (JSON)</span>
                <textarea
                  className="mt-1 w-full min-h-[120px] rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs"
                  value={routeConfigText}
                  onChange={(e) => setRouteConfigText(e.target.value)}
                  spellCheck={false}
                />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monedas</CardTitle>
              <CardDescription>Mínimo y máximo por moneda; al editar se sustituye el conjunto completo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {currencies.map((row, idx) => (
                <div key={idx} className="flex flex-wrap items-end gap-2 border-b border-slate-100 pb-3">
                  <label className="text-sm">
                    <span className="text-xs font-medium text-slate-600">Moneda</span>
                    <Input
                      className="mt-1 w-24 uppercase"
                      value={row.currency}
                      onChange={(e) => {
                        const next = [...currencies];
                        next[idx] = { ...row, currency: e.target.value.toUpperCase() };
                        setCurrencies(next);
                      }}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-xs font-medium text-slate-600">Mín.</span>
                    <Input
                      className="mt-1 w-28 font-mono text-sm"
                      value={row.minAmount}
                      onChange={(e) => {
                        const next = [...currencies];
                        next[idx] = { ...row, minAmount: e.target.value };
                        setCurrencies(next);
                      }}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-xs font-medium text-slate-600">Máx.</span>
                    <Input
                      className="mt-1 w-28 font-mono text-sm"
                      value={row.maxAmount}
                      onChange={(e) => {
                        const next = [...currencies];
                        next[idx] = { ...row, maxAmount: e.target.value };
                        setCurrencies(next);
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.isDefault}
                      onChange={(e) => {
                        const next = [...currencies];
                        next[idx] = { ...row, isDefault: e.target.checked };
                        setCurrencies(next);
                      }}
                    />
                    Por defecto
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrencies(currencies.filter((_, i) => i !== idx))}
                  >
                    Quitar
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCurrencies([...currencies, { ...emptyCurrencyRow(), isDefault: false }])}
              >
                Añadir moneda
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="primary"
              disabled={createMut.isPending || patchMut.isPending}
              onClick={onSubmit}
            >
              {isEdit ? "Guardar cambios" : "Crear ruta"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
