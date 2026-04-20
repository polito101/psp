"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LoginMode = "admin" | "merchant";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("admin");
  const [adminToken, setAdminToken] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [merchantToken, setMerchantToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const body =
        mode === "admin"
          ? { mode: "admin" as const, token: adminToken }
          : {
              mode: "merchant" as const,
              merchantId: merchantId.trim(),
              merchantToken: merchantToken.trim(),
            };

      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        let message = "No se pudo iniciar sesión";
        try {
          const payload = (await res.json()) as { message?: string };
          if (payload?.message) message = payload.message;
        } catch {
          // no-op
        }
        setError(message);
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Acceso al backoffice</h2>
      <p className="mt-2 text-sm text-slate-600">
        El servidor emite una cookie HttpOnly con un JWT de sesión. Modo <strong>admin</strong>: usa{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">BACKOFFICE_ADMIN_SECRET</code>. Modo{" "}
        <strong>merchant</strong>: introduce tu <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">merchantId</code>{" "}
        y un token <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">expUnix:hexHmac</code> (HMAC de{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">merchantId.exp</code>, válido unos minutos; ver README).
      </p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Tipo de acceso</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mode"
                value="admin"
                checked={mode === "admin"}
                onChange={() => setMode("admin")}
              />
              Administrador
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mode"
                value="merchant"
                checked={mode === "merchant"}
                onChange={() => setMode("merchant")}
              />
              Merchant
            </label>
          </div>
        </fieldset>

        {mode === "admin" ? (
          <div>
            <label htmlFor="adminToken" className="block text-sm font-medium text-slate-700">
              Secreto de administrador
            </label>
            <input
              id="adminToken"
              name="adminToken"
              type="password"
              autoComplete="off"
              value={adminToken}
              onChange={(ev) => setAdminToken(ev.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              required
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="merchantId" className="block text-sm font-medium text-slate-700">
                Merchant ID
              </label>
              <input
                id="merchantId"
                name="merchantId"
                type="text"
                autoComplete="off"
                value={merchantId}
                onChange={(ev) => setMerchantId(ev.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                required
              />
            </div>
            <div>
              <label htmlFor="merchantToken" className="block text-sm font-medium text-slate-700">
                Token merchant (expUnix:hexHmac)
              </label>
              <input
                id="merchantToken"
                name="merchantToken"
                type="password"
                autoComplete="off"
                value={merchantToken}
                onChange={(ev) => setMerchantToken(ev.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                required
              />
            </div>
          </>
        )}

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-60"
        >
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
