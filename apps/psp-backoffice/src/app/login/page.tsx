"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
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
        body: JSON.stringify({ token }),
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
        Introduce el valor de <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">BACKOFFICE_ADMIN_SECRET</code>{" "}
        definido en <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env.local</code>. Se guardará una cookie
        HttpOnly en este origen.
      </p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label htmlFor="token" className="block text-sm font-medium text-slate-700">
            Token de administrador
          </label>
          <input
            id="token"
            name="token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(ev) => setToken(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            required
          />
        </div>
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
