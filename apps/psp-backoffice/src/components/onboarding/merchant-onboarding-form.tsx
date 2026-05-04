"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Building2 } from "lucide-react";
import type { MerchantOnboardingTokenResponse } from "@/lib/api/contracts";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

const fieldClass =
  "h-11 rounded-xl border-white/12 bg-white/5 text-white shadow-none placeholder:text-white/35 focus:border-white/25 focus:ring-0";

const labelClass = "text-sm font-medium text-white";

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
    const websiteUrlRaw = String(formData.get("websiteUrl") ?? "").trim();
    const body: Record<string, string> = {
      companyName: String(formData.get("companyName") ?? "").trim(),
      industry: String(formData.get("industry") ?? "").trim(),
    };
    if (websiteUrlRaw) {
      body.websiteUrl = websiteUrlRaw;
    }

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
    <main className="relative min-h-screen overflow-hidden bg-[#09090f] text-[#f2f2ff]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-0 right-0 h-[420px] w-[480px] rounded-full bg-[#a020c8]/14 blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-[380px] w-[420px] rounded-full bg-[#5b6ef7]/12 blur-[110px]" />
        <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00d4c8]/8 blur-[100px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl px-6 pb-20 pt-16 lg:px-8 lg:pb-28 lg:pt-24">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-brand-gradient">Merchants</span>
          <h1 className="mt-4 text-balance text-3xl font-bold tracking-tight text-white lg:text-5xl">
            Completa los datos de tu comercio
          </h1>
          <p className="mt-5 text-base leading-relaxed text-[#8b8baa]">
            Usaremos esta información para revisar tu solicitud y preparar la activación de tu cuenta Finara.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-sm lg:p-10">
          <div className="mb-8 flex items-start gap-4 border-b border-white/10 pb-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/8 ring-1 ring-white/10">
              <Building2 className="h-6 w-6 text-[#00cfc8]" aria-hidden />
            </div>
            <div className="min-w-0 text-left">
              <h2 className="text-lg font-semibold text-white">Perfil de negocio</h2>
              <p className="mt-1 text-sm text-[#8b8baa]">Nombre de empresa y sector para la revisión comercial.</p>
            </div>
          </div>

          {tokenState.status === "loading" ? (
            <p className="text-center text-sm text-[#8b8baa]" aria-live="polite">
              Validando enlace…
            </p>
          ) : tokenState.status === "invalid" ? (
            <div
              className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100"
              role="status"
            >
              Este enlace no es válido o ha caducado. Solicita un nuevo enlace a tu contacto de Finara.
            </div>
          ) : tokenState.status === "error" ? (
            <div
              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100"
              role="alert"
            >
              No pudimos validar el enlace en este momento. Inténtalo de nuevo más tarde.
            </div>
          ) : submitState === "success" ? (
            <div
              className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-50"
              role="status"
            >
              <p className="font-medium text-emerald-100">Datos enviados correctamente</p>
              <p className="mt-2 text-emerald-100/90">
                Revisaremos tu solicitud y te contactaremos pronto.
              </p>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className={labelClass} htmlFor="companyName">
                  Nombre de la empresa
                </label>
                <Input
                  id="companyName"
                  name="companyName"
                  minLength={2}
                  maxLength={160}
                  required
                  autoComplete="organization"
                  className={fieldClass}
                />
              </div>

              <div className="space-y-2">
                <label className={labelClass} htmlFor="industry">
                  Sector
                </label>
                <Select
                  id="industry"
                  name="industry"
                  required
                  defaultValue=""
                  className={cn(fieldClass, "py-0")}
                >
                  <option value="" disabled className="bg-[#111118] text-slate-200">
                    Selecciona una opción
                  </option>
                  <option value="CLOUD_COMPUTING" className="bg-[#111118]">
                    Cloud computing
                  </option>
                  <option value="CRYPTO" className="bg-[#111118]">
                    Crypto
                  </option>
                  <option value="FOREX" className="bg-[#111118]">
                    Forex
                  </option>
                  <option value="GAMBLING" className="bg-[#111118]">
                    Gambling
                  </option>
                  <option value="PSP" className="bg-[#111118]">
                    PSP
                  </option>
                  <option value="OTHER" className="bg-[#111118]">
                    Otro
                  </option>
                </Select>
              </div>

              <div className="space-y-2">
                <label className={labelClass} htmlFor="websiteUrl">
                  Sitio web <span className="font-normal text-[#8b8baa]">(opcional)</span>
                </label>
                <Input
                  id="websiteUrl"
                  name="websiteUrl"
                  type="url"
                  maxLength={2048}
                  placeholder="https://example.com"
                  autoComplete="url"
                  className={fieldClass}
                />
              </div>

              {submitState === "error" ? (
                <div
                  className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
                  role="alert"
                >
                  No pudimos enviar los datos. Revisa el formulario e inténtalo de nuevo.
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <button
                  type="submit"
                  disabled={submitState === "submitting"}
                  className="btn-brand-gradient inline-flex h-11 items-center justify-center rounded-full px-8 text-sm font-semibold text-white shadow-lg shadow-[#5b6ef7]/15 transition-opacity hover:opacity-[0.92] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  {submitState === "submitting" ? "Enviando…" : "Enviar datos"}
                </button>
                <p className="max-w-md text-xs leading-relaxed text-[#8b8baa]">
                  Al enviar este formulario confirmas que los datos corresponden a tu empresa y pueden usarse para la
                  revisión comercial.
                </p>
              </div>
            </form>
          )}
        </div>

        <p className="mt-10 text-center text-xs text-[#6b6b85]">
          Finara · Infraestructura de pagos para empresas que escalan sin fronteras.
        </p>
      </div>
    </main>
  );
}
