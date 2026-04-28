"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Store,
  UserCog,
} from "lucide-react";

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
    <div className="relative isolate -mx-2 sm:mx-0">
      {/* Subtle decorative background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl"
      >
        <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-[var(--primary)]/10 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-sky-200/40 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(15, 23, 42, 0.08) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
      </div>

      <div className="grid items-stretch gap-8 py-4 sm:py-8 lg:grid-cols-[1.05fr_minmax(0,1fr)] lg:gap-12">
        {/* Left: brand / value props (hidden on small screens) */}
        <aside className="hidden flex-col justify-between rounded-2xl border border-slate-200/70 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-8 text-slate-100 shadow-xl lg:flex">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-300 backdrop-blur">
              <ShieldCheck size={14} aria-hidden />
              Acceso seguro
            </div>
            <h2 className="mt-6 text-balance text-3xl font-semibold leading-tight text-white">
              Bienvenido al Backoffice PSP
            </h2>
            <p className="mt-3 text-pretty text-sm leading-relaxed text-slate-300">
              Panel operativo para administradores y merchants. Inicia sesión para acceder a
              transacciones, conciliación y monitoreo en tiempo real.
            </p>
          </div>

          <ul className="mt-10 space-y-4 text-sm">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
                <Lock size={16} aria-hidden />
              </span>
              <div>
                <p className="font-medium text-white">Sesión cifrada</p>
                <p className="text-slate-400">Cookie HttpOnly con JWT firmado.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
                <ShieldCheck size={16} aria-hidden />
              </span>
              <div>
                <p className="font-medium text-white">Roles separados</p>
                <p className="text-slate-400">Acceso diferenciado para admin y merchant.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
                <KeyRound size={16} aria-hidden />
              </span>
              <div>
                <p className="font-medium text-white">Tokens efímeros</p>
                <p className="text-slate-400">Validez de pocos minutos para merchants.</p>
              </div>
            </li>
          </ul>

          <p className="mt-10 text-xs text-slate-400">
            &copy; {new Date().getFullYear()} PSP Backoffice
          </p>
        </aside>

        {/* Right: form card */}
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-900/5 ring-1 ring-black/[0.02] backdrop-blur-sm sm:p-8">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-balance text-2xl font-semibold tracking-tight text-slate-900">
                Acceso al backoffice
              </h2>
              <p className="text-pretty text-sm leading-relaxed text-slate-600">
                El servidor emite una cookie HttpOnly con un JWT de sesión. Modo{" "}
                <strong className="font-semibold text-slate-800">admin</strong>: usa{" "}
                <code className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  BACKOFFICE_ADMIN_SECRET
                </code>
                . Modo <strong className="font-semibold text-slate-800">merchant</strong>: introduce
                tu{" "}
                <code className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  merchantId
                </code>{" "}
                y un token{" "}
                <code className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  expUnix:hexHmac
                </code>{" "}
                (HMAC de{" "}
                <code className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                  merchantId.exp
                </code>
                , válido unos minutos; ver README).
              </p>
            </div>

            <form className="mt-7 space-y-5" onSubmit={onSubmit}>
              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-slate-700">
                  Tipo de acceso
                </legend>
                <div
                  role="radiogroup"
                  className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-1"
                >
                  <label
                    className={`group relative flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                      mode === "admin"
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value="admin"
                      checked={mode === "admin"}
                      onChange={() => setMode("admin")}
                      className="sr-only"
                    />
                    <UserCog
                      size={16}
                      aria-hidden
                      className={
                        mode === "admin"
                          ? "text-[var(--primary)]"
                          : "text-slate-400 group-hover:text-slate-600"
                      }
                    />
                    Administrador
                  </label>
                  <label
                    className={`group relative flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                      mode === "merchant"
                        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value="merchant"
                      checked={mode === "merchant"}
                      onChange={() => setMode("merchant")}
                      className="sr-only"
                    />
                    <Store
                      size={16}
                      aria-hidden
                      className={
                        mode === "merchant"
                          ? "text-[var(--primary)]"
                          : "text-slate-400 group-hover:text-slate-600"
                      }
                    />
                    Merchant
                  </label>
                </div>
              </fieldset>

              {mode === "admin" ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor="adminToken"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Secreto de administrador
                  </label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition-colors group-focus-within:text-[var(--primary)]">
                      <Lock size={16} aria-hidden />
                    </span>
                    <input
                      id="adminToken"
                      name="adminToken"
                      type="password"
                      autoComplete="off"
                      placeholder="Introduce el secreto"
                      value={adminToken}
                      onChange={(ev) => setAdminToken(ev.target.value)}
                      className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                      required
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="merchantId"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Merchant ID
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition-colors group-focus-within:text-[var(--primary)]">
                        <Store size={16} aria-hidden />
                      </span>
                      <input
                        id="merchantId"
                        name="merchantId"
                        type="text"
                        autoComplete="off"
                        placeholder="merch_..."
                        value={merchantId}
                        onChange={(ev) => setMerchantId(ev.target.value)}
                        className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 font-mono text-sm text-slate-900 shadow-sm transition-all placeholder:font-sans placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="merchantToken"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Token merchant{" "}
                      <span className="font-normal text-slate-500">(expUnix:hexHmac)</span>
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition-colors group-focus-within:text-[var(--primary)]">
                        <KeyRound size={16} aria-hidden />
                      </span>
                      <input
                        id="merchantToken"
                        name="merchantToken"
                        type="password"
                        autoComplete="off"
                        placeholder="1700000000:abcd..."
                        value={merchantToken}
                        onChange={(ev) => setMerchantToken(ev.target.value)}
                        className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        required
                      />
                    </div>
                  </div>
                </>
              )}

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
                >
                  <AlertCircle
                    size={16}
                    aria-hidden
                    className="mt-0.5 shrink-0 text-red-500"
                  />
                  <p className="leading-relaxed">{error}</p>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[var(--primary)]/20 transition-all hover:brightness-110 hover:shadow-md hover:shadow-[var(--primary)]/25 focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/30 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100 disabled:hover:shadow-sm"
              >
                {pending ? (
                  <>
                    <Loader2 size={16} aria-hidden className="animate-spin" />
                    Entrando…
                  </>
                ) : (
                  <>
                    Entrar
                    <ArrowRight
                      size={16}
                      aria-hidden
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </>
                )}
              </button>

              <p className="flex items-center justify-center gap-1.5 pt-1 text-xs text-slate-500">
                <Lock size={12} aria-hidden />
                Conexión cifrada · cookie HttpOnly
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
