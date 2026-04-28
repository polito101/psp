"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Store,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LoginMode = "admin" | "merchant";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("admin");
  const [adminToken, setAdminToken] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [merchantToken, setMerchantToken] = useState("");
  const [showAdminToken, setShowAdminToken] = useState(false);
  const [showMerchantToken, setShowMerchantToken] = useState(false);
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
    <div className="mx-auto w-full max-w-3xl">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[1.05fr_minmax(0,1fr)]">
          {/* Panel informativo */}
          <aside className="relative hidden overflow-hidden bg-slate-900 p-8 text-slate-100 lg:flex lg:flex-col lg:justify-between">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--primary)] opacity-25 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-indigo-400 opacity-15 blur-3xl"
            />

            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-200 backdrop-blur">
                <ShieldCheck size={12} aria-hidden />
                Acceso seguro
              </div>
              <h2 className="mt-6 text-2xl font-semibold leading-tight text-white text-balance">
                Backoffice del PSP
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300 text-pretty">
                Sesión emitida por el servidor mediante una cookie HttpOnly con un JWT firmado. Elige el rol con el que
                vas a operar: administración global o portal del comercio.
              </p>
            </div>

            <ul className="relative mt-8 space-y-4 text-sm text-slate-300">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <Lock size={14} aria-hidden />
                </span>
                <div>
                  <p className="font-medium text-slate-100">Cookie HttpOnly</p>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Token firmado, no accesible desde JavaScript del cliente.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <Fingerprint size={14} aria-hidden />
                </span>
                <div>
                  <p className="font-medium text-slate-100">HMAC con expiración</p>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Los tokens de merchant son temporales y verificados en backend.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-100">
                  <Building2 size={14} aria-hidden />
                </span>
                <div>
                  <p className="font-medium text-slate-100">Aislamiento por comercio</p>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Cada merchant accede solo a sus propios recursos y métricas.
                  </p>
                </div>
              </li>
            </ul>

            <p className="relative mt-8 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              PSP · Entorno operativo
            </p>
          </aside>

          {/* Formulario */}
          <section className="p-6 sm:p-8">
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
              <p className="mt-1 text-sm text-slate-600">
                Selecciona tu tipo de acceso e introduce las credenciales correspondientes.
              </p>
            </div>

            {/* Selector segmentado */}
            <div
              role="tablist"
              aria-label="Tipo de acceso"
              className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "admin"}
                onClick={() => {
                  setMode("admin");
                  setError("");
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                  mode === "admin"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <ShieldCheck size={15} aria-hidden />
                Administrador
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "merchant"}
                onClick={() => {
                  setMode("merchant");
                  setError("");
                }}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                  mode === "merchant"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <Store size={15} aria-hidden />
                Merchant
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              {mode === "admin" ? (
                <div>
                  <label htmlFor="adminToken" className="block text-sm font-medium text-slate-700">
                    Secreto de administrador
                  </label>
                  <div className="relative mt-1.5">
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    >
                      <KeyRound size={16} />
                    </span>
                    <input
                      id="adminToken"
                      name="adminToken"
                      type={showAdminToken ? "text" : "password"}
                      autoComplete="off"
                      value={adminToken}
                      onChange={(ev) => setAdminToken(ev.target.value)}
                      placeholder="BACKOFFICE_ADMIN_SECRET"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-10 font-mono text-sm shadow-sm transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminToken((v) => !v)}
                      aria-label={showAdminToken ? "Ocultar token" : "Mostrar token"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      {showAdminToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Coincide con la variable de entorno{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                      BACKOFFICE_ADMIN_SECRET
                    </code>
                    .
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="merchantId" className="block text-sm font-medium text-slate-700">
                      Merchant ID
                    </label>
                    <div className="relative mt-1.5">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      >
                        <Building2 size={16} />
                      </span>
                      <input
                        id="merchantId"
                        name="merchantId"
                        type="text"
                        autoComplete="off"
                        value={merchantId}
                        onChange={(ev) => setMerchantId(ev.target.value)}
                        placeholder="merchant_xxxx"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 font-mono text-sm shadow-sm transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="merchantToken" className="block text-sm font-medium text-slate-700">
                      Token merchant
                    </label>
                    <div className="relative mt-1.5">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      >
                        <Fingerprint size={16} />
                      </span>
                      <input
                        id="merchantToken"
                        name="merchantToken"
                        type={showMerchantToken ? "text" : "password"}
                        autoComplete="off"
                        value={merchantToken}
                        onChange={(ev) => setMerchantToken(ev.target.value)}
                        placeholder="expUnix:hexHmac"
                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-10 font-mono text-sm shadow-sm transition placeholder:text-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowMerchantToken((v) => !v)}
                        aria-label={showMerchantToken ? "Ocultar token" : "Mostrar token"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        {showMerchantToken ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                      Formato{" "}
                      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                        expUnix:hexHmac
                      </code>
                      . HMAC de{" "}
                      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                        merchantId.exp
                      </code>{" "}
                      con validez de unos minutos. Ver README.
                    </p>
                  </div>
                </>
              )}

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? (
                  <>
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                    Entrando…
                  </>
                ) : (
                  <>
                    <Lock size={15} aria-hidden />
                    Entrar
                  </>
                )}
              </button>

              <p className="pt-2 text-center text-xs text-slate-500">
                Al continuar, aceptas que el servidor establezca una cookie de sesión{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-700">
                  backoffice_session
                </code>
                .
              </p>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
