"use client"

import type { FormEvent } from "react"
import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ApiSuccess = {
  ok?: boolean
  message?: string
  onboardingUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseApiPayload(json: unknown): ApiSuccess {
  if (!isRecord(json)) return {}
  const onboardingUrl = json.onboardingUrl
  return {
    ok: typeof json.ok === "boolean" ? json.ok : undefined,
    message: typeof json.message === "string" ? json.message : undefined,
    onboardingUrl: typeof onboardingUrl === "string" ? onboardingUrl : undefined,
  }
}

export function MerchantSignupForm() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<ApiSuccess | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch("/api/merchant-onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
        }),
      })
      const json: unknown = await response.json().catch(() => ({}))
      const payload = parseApiPayload(json)
      if (!response.ok) {
        setError(payload.message ?? "No se pudo enviar la solicitud. Inténtalo de nuevo.")
        return
      }
      setSuccess(payload)
      setName("")
      setEmail("")
      setPhone("")
    } catch {
      setError("No se pudo enviar la solicitud. Comprueba tu conexión e inténtalo de nuevo.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-6" onSubmit={onSubmit} noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="merchant-name" className="text-white">
            Nombre completo
          </Label>
          <Input
            id="merchant-name"
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className="h-11 rounded-xl border-white/12 bg-white/5 text-white placeholder:text-white/35"
            placeholder="Tu nombre"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="merchant-email" className="text-white">
            Email de trabajo
          </Label>
          <Input
            id="merchant-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            className="h-11 rounded-xl border-white/12 bg-white/5 text-white placeholder:text-white/35"
            placeholder="tu@empresa.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="merchant-phone" className="text-white">
            Teléfono
          </Label>
          <Input
            id="merchant-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            minLength={6}
            maxLength={64}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            className="h-11 rounded-xl border-white/12 bg-white/5 text-white placeholder:text-white/35"
            placeholder="+34 …"
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      {success?.message ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
          <p>{success.message}</p>
          {success.onboardingUrl ? (
            <p className="mt-3 text-xs text-emerald-100/90">
              En entornos de desarrollo o sandbox, puedes abrir el link directamente:{" "}
              <Link
                href={success.onboardingUrl}
                className="font-medium text-white underline-offset-4 hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                continuar onboarding
              </Link>
              .
            </p>
          ) : (
            <p className="mt-3 text-xs text-emerald-100/80">
              Revisa tu bandeja de entrada (y spam) para el email con el enlace de onboarding.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={busy}
          className="btn-brand-gradient h-11 rounded-full px-8 text-sm font-semibold text-white"
        >
          {busy ? "Enviando…" : "Solicitar alta"}
        </Button>
        <p className="text-xs text-[#8b8baa] max-w-md leading-relaxed">
          Al enviar este formulario aceptas que podamos contactarte sobre tu solicitud.
        </p>
      </div>
    </form>
  )
}
