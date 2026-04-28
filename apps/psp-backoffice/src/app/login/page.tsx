"use client";

import { type FormEvent, useState } from "react";
import Image from "next/image";
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
    <div className="relative min-h-screen w-full bg-slate-50">
      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Panel marca */}
        <aside className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
          {/* Halos */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-[var(--primary)] opacity-30 blur-[120px]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-40 -left-32 h-[26rem] w-[26rem] rounded-full bg-indigo-500 opacity-20 blur-[120px]"
          />
          {/* Grid de puntos */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "28px 28px",
            }}
          />

          {/* Header marca */}
          <div className="relative z-10 flex flex-col items-start">
            <Image
              src="/finara-logo.png"
              alt="Finara"
              width={640}
              height={240}
              priority
              className="h-48 w-auto object-contain xl:h-64"
            />
          </div>

          {/* Hero */}
          <div className="relative z-10 max-w-lg">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-200 backdrop-blur">
              <ShieldCheck size={12} aria-hidden />
              Acceso seguro
            </div>
            <h2 className="mt-6 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white xl:text-5xl">
              Operaciones,{" "}
              <span className="bg-gradient-to-r from-indigo-300 to-[var(--primary)] bg-clip-text text-transparent">
                en tiempo real
              </span>
            </h2>
            <p className="mt-5 max-w-md text-pretty text-base leading-relaxed text-slate-300">
              Monitorea pagos, conciliaciones y la salud operativa de cada
              comercio desde una única consola unificada.
            </p>

            <ul className="mt-10 space-y-5 text-sm">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Lock size={15} className="text-slate-100" aria-hidden />
                </span>
                <div>
                  <p className="font-medium text-white">Cookie HttpOnly firmada</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                    JWT emitido por el servidor, no accesible desde JavaScript.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Fingerprint size={15} className="text-slate-100" aria-hidden />
                </span>
                <div>
                  <p className="font-medium text-white">HMAC con expiración</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                    Tokens de merchant temporales y verificados en el backend.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Building2 size={15} className="text-slate-100" aria-hidden />
                </span>
                <div>
                  <p className="font-medium text-white">Aislamiento por comercio</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                    Cada merchant accede solo a sus propios recursos y métricas.
                  </p>
                </div>
              </li>
            </ul>
          </div>

          {/* Footer marca */}
          <div className="relative z-10 flex items-center justify-between text-xs text-slate-500">
            <p className="uppercase tracking-[0.18em]">Entorno operativo</p>
            <p className="font-mono">v1.0</p>
          </div>
        </aside>

        {/* Formulario */}
        <section className="relative flex items-center justify-center px-4 py-16 sm:px-8 lg:py-12">
          <div className="w-full max-w-md">
            {/* Marca móvil */}
            <div className="mb-12 flex flex-col items-start lg:hidden">
              <Image
                src="/finara-logo.png"
                alt="Finara"
                width={520}
                height={200}
                priority
                className="h-40 w-auto object-contain"
              />
            </div>

            {/* Header */}
            <div className="mb-8">
              <h1 className="text-balance text-3xl font-semibold tracking-tight text-slate-900">
                Bienvenido de nuevo
              </h1>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
                Selecciona tu tipo de acceso e introduce las credenciales para
                entrar al backoffice.
              </p>
            </div>

            {/* Selector segmentado */}
            <div
              role="tablist"
              aria-label="Tipo de acceso"
              className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1"
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
                  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition",
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
                  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                  mode === "merchant"
                    ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:text-slate-900",
                )}
              >
                <Store size={15} aria-hidden />
                Merchant
              </button>
            </div>

            <form className="mt-7 space-y-5" onSubmit={onSubmit}>
              {mode === "admin" ? (
                <div>
                  <label
                    htmlFor="adminToken"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Secreto de administrador
                  </label>
                  <div className="group relative mt-1.5">
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition group-focus-within:text-[var(--primary)]"
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
                      className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 font-mono text-sm shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowAdminToken((v) => !v)}
                      aria-label={showAdminToken ? "Ocultar token" : "Mostrar token"}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      {showAdminToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Coincide con la variable de entorno{" "}
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                      BACKOFFICE_ADMIN_SECRET
                    </code>
                    .
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label
                      htmlFor="merchantId"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Merchant ID
                    </label>
                    <div className="group relative mt-1.5">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition group-focus-within:text-[var(--primary)]"
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
                        className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 font-mono text-sm shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="merchantToken"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Token merchant
                    </label>
                    <div className="group relative mt-1.5">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition group-focus-within:text-[var(--primary)]"
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
                        className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 font-mono text-sm shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowMerchantToken((v) => !v)}
                        aria-label={showMerchantToken ? "Ocultar token" : "Mostrar token"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      >
                        {showMerchantToken ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Formato{" "}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                        expUnix:hexHmac
                      </code>
                      . HMAC de{" "}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                        merchantId.exp
                      </code>{" "}
                      con validez de unos minutos.
                    </p>
                  </div>
                </>
              )}

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
                >
                  <AlertCircle
                    size={16}
                    className="mt-0.5 shrink-0"
                    aria-hidden
                  />
                  <span className="leading-relaxed">{error}</span>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={pending}
                className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? (
                  <>
                    <Loader2 size={15} className="animate-spin" aria-hidden />
                    Entrando…
                  </>
                ) : (
                  <>
                    <Lock size={15} aria-hidden />
                    Entrar al backoffice
                  </>
                )}
              </button>
            </form>

            <p className="mt-8 text-center text-xs leading-relaxed text-slate-500">
              Al continuar, aceptas que el servidor establezca una cookie de
              sesión{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                backoffice_session
              </code>
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
