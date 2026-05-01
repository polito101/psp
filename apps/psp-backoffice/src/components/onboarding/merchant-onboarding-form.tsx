"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MerchantOnboardingTokenResponse } from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type MerchantOnboardingFormProps = {
  token: string;
};

type TokenState =
  | { status: "loading" }
  | { status: "valid"; data: MerchantOnboardingTokenResponse }
  | { status: "invalid" }
  | { status: "error" };

type SubmitState = "idle" | "submitting" | "success" | "error";

const invalidTokenStatuses = new Set([400, 401, 403, 404, 410]);

export function MerchantOnboardingForm({ token }: MerchantOnboardingFormProps) {
  const [tokenState, setTokenState] = useState<TokenState>({ status: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const submitAbortRef = useRef<AbortController | null>(null);

  const encodedToken = useMemo(() => encodeURIComponent(token), [token]);

  useEffect(() => {
    const controller = new AbortController();
    setSubmitState("idle");
    submitAbortRef.current?.abort();
    submitAbortRef.current = null;

    async function validateToken() {
      setTokenState({ status: "loading" });
      try {
        const response = await fetch(`/api/public/onboarding/${encodedToken}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          setTokenState({ status: invalidTokenStatuses.has(response.status) ? "invalid" : "error" });
          return;
        }

        const data = (await response.json()) as MerchantOnboardingTokenResponse;
        setTokenState({ status: "valid", data });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setTokenState({ status: "error" });
      }
    }

    void validateToken();

    return () => {
      controller.abort();
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
    };
  }, [encodedToken]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tokenState.status !== "valid" || submitState === "submitting") {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const country = String(formData.get("country") ?? "").trim().toUpperCase();
    const body = {
      tradeName: String(formData.get("tradeName") ?? "").trim(),
      legalName: String(formData.get("legalName") ?? "").trim(),
      country,
      website: String(formData.get("website") ?? "").trim(),
      businessType: String(formData.get("businessType") ?? "").trim(),
    };

    setSubmitState("submitting");
    submitAbortRef.current?.abort();
    const submitController = new AbortController();
    submitAbortRef.current = submitController;

    try {
      const response = await fetch(`/api/public/onboarding/${encodedToken}/business-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: submitController.signal,
      });

      if (submitAbortRef.current !== submitController) {
        return;
      }

      if (!response.ok) {
        setSubmitState("error");
        return;
      }

      setSubmitState("success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setSubmitState("error");
    } finally {
      if (submitAbortRef.current === submitController) {
        submitAbortRef.current = null;
      }
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="text-sm font-medium text-[var(--primary)]">Merchant onboarding</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Completa los datos de tu comercio</h1>
          <p className="mt-2 text-sm text-slate-600">
            Usaremos esta información para revisar tu solicitud y preparar la activación.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Perfil de negocio</CardTitle>
            <CardDescription>Introduce los datos legales y comerciales de la empresa.</CardDescription>
          </CardHeader>
          <CardContent>
            {tokenState.status === "loading" ? (
              <p className="text-sm text-slate-500" aria-live="polite">
                Validando enlace…
              </p>
            ) : tokenState.status === "invalid" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
                Este enlace no es válido o ha caducado. Solicita un nuevo enlace a tu contacto de Finara.
              </div>
            ) : tokenState.status === "error" ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
                No pudimos validar el enlace en este momento. Inténtalo de nuevo más tarde.
              </div>
            ) : submitState === "success" ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
                Datos enviados. Revisaremos tu solicitud y te contactaremos pronto.
              </div>
            ) : (
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700" htmlFor="tradeName">
                      Nombre comercial
                    </label>
                    <Input
                      id="tradeName"
                      name="tradeName"
                      minLength={2}
                      maxLength={160}
                      required
                      autoComplete="organization"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700" htmlFor="legalName">
                      Razón social
                    </label>
                    <Input
                      id="legalName"
                      name="legalName"
                      minLength={2}
                      maxLength={200}
                      required
                      autoComplete="organization"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700" htmlFor="country">
                      País
                    </label>
                    <Input
                      id="country"
                      name="country"
                      maxLength={2}
                      minLength={2}
                      pattern="[A-Za-z]{2}"
                      placeholder="ES"
                      required
                      autoComplete="country"
                      className="uppercase"
                    />
                    <p className="text-xs text-slate-500">Código ISO de 2 letras, por ejemplo ES.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700" htmlFor="businessType">
                      Tipo de negocio
                    </label>
                    <Select id="businessType" name="businessType" required defaultValue="">
                      <option value="" disabled>
                        Selecciona una opción
                      </option>
                      <option value="ecommerce">Ecommerce</option>
                      <option value="marketplace">Marketplace</option>
                      <option value="retail">Retail</option>
                      <option value="services">Servicios</option>
                      <option value="other">Otro</option>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="website">
                    Sitio web <span className="font-normal text-slate-500">(opcional)</span>
                  </label>
                  <Input
                    id="website"
                    name="website"
                    type="url"
                    maxLength={2048}
                    placeholder="https://example.com"
                    autoComplete="url"
                  />
                </div>

                {submitState === "error" ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
                    No pudimos enviar los datos. Revisa el formulario e inténtalo de nuevo.
                  </div>
                ) : null}

                <Button type="submit" variant="primary" disabled={submitState === "submitting"}>
                  {submitState === "submitting" ? "Enviando…" : "Enviar datos"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
