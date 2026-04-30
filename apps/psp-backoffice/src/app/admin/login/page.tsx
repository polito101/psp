"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Lock } from "lucide-react";

/** Login operativo minimalista (solo portal admin). */
export default function AdminLoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "admin" as const, token }),
        credentials: "include",
      });
      if (!res.ok) {
        let message = "Credenciales no válidas";
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
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white p-8 shadow-xl">
        <div className="mb-6 flex justify-center rounded-lg bg-[var(--primary)]/15 p-3">
          <Lock className="h-8 w-8 text-[var(--primary)]" aria-hidden />
        </div>
        <h1 className="text-center text-xl font-semibold text-slate-900">Admin Finara</h1>
        <p className="mt-1 text-center text-sm text-slate-600">Acceso operativo interno.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="adminToken" className="mb-1 block text-sm font-medium text-slate-700">
              Secreto administrador
            </label>
            <input
              id="adminToken"
              name="adminToken"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(ev) => setToken(ev.target.value)}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20"
              required
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
