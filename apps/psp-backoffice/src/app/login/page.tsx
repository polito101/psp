"use client";

import { type FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, KeyRound, Loader2, Lock, Mail, ShieldCheck, Store } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const body = {
        mode: "merchant" as const,
        email: email.trim(),
        password,
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
    <div className="relative isolate min-h-screen overflow-hidden bg-slate-950">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-gradient-to-br from-cyan-500/30 via-fuchsia-500/20 to-transparent blur-3xl" />
        <div className="absolute -right-32 top-1/3 h-[32rem] w-[32rem] rounded-full bg-gradient-to-br from-fuchsia-500/25 via-rose-500/20 to-orange-400/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[26rem] w-[26rem] rounded-full bg-gradient-to-tr from-amber-400/20 via-rose-500/15 to-transparent blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 lg:py-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative h-9 w-28">
              <Image
                src="/finara-logo.png"
                alt="Finara"
                fill
                sizes="112px"
                className="object-contain object-left"
                priority
              />
            </div>
            <span className="hidden h-5 w-px bg-white/15 sm:block" aria-hidden />
            <p className="hidden text-xs font-medium uppercase tracking-[0.22em] text-slate-400 sm:block">
              Portal merchant
            </p>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-300 backdrop-blur sm:inline-flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Área cliente
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.1fr_minmax(0,1fr)] lg:gap-16 lg:py-16">
          <section className="hidden flex-col justify-center lg:flex">
            <div className="relative w-full max-w-lg">
              <div className="relative h-44 w-full">
                <Image
                  src="/finara-logo.png"
                  alt="Finara"
                  fill
                  sizes="(min-width: 1024px) 520px, 100vw"
                  className="object-contain object-left drop-shadow-[0_8px_40px_rgba(217,70,239,0.35)]"
                />
              </div>
              <div
                aria-hidden
                className="absolute -bottom-2 left-0 -z-10 h-16 w-3/4 rounded-full bg-gradient-to-r from-cyan-500/30 via-fuchsia-500/30 to-orange-400/30 blur-3xl"
              />
            </div>

            <h1 className="mt-10 text-balance text-4xl font-semibold leading-tight tracking-tight text-white">
              Accede a tu{" "}
              <span className="bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-orange-300 bg-clip-text text-transparent">
                portal merchant
              </span>
            </h1>
            <p className="mt-3 max-w-md text-pretty text-base leading-relaxed text-slate-300">
              Usa el correo y la contraseña iniciales que te enviamos al crear tu solicitud de alta.
            </p>

            <ul className="mt-8 grid max-w-md grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <li className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
                <Lock size={14} aria-hidden className="mt-0.5 shrink-0 text-cyan-300" />
                <div>
                  <p className="font-medium text-white">Cifrado</p>
                  <p className="text-xs text-slate-400">JWT en cookie HttpOnly</p>
                </div>
              </li>
              <li className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
                <ShieldCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-fuchsia-300" />
                <div>
                  <p className="font-medium text-white">Alcance</p>
                  <p className="text-xs text-slate-400">Solo tus datos</p>
                </div>
              </li>
              <li className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
                <Store size={14} aria-hidden className="mt-0.5 shrink-0 text-orange-300" />
                <div>
                  <p className="font-medium text-white">Acceso</p>
                  <p className="text-xs text-slate-400">Email verificado</p>
                </div>
              </li>
            </ul>
          </section>

          <section className="mx-auto w-full max-w-md">
            <div className="mb-8 flex items-center justify-center lg:hidden">
              <div className="relative h-14 w-44">
                <Image
                  src="/finara-logo.png"
                  alt="Finara"
                  fill
                  sizes="176px"
                  className="object-contain drop-shadow-[0_4px_24px_rgba(217,70,239,0.35)]"
                />
              </div>
            </div>

            <div className="relative">
              <div
                aria-hidden
                className="absolute -inset-px -z-10 rounded-2xl bg-gradient-to-br from-cyan-400/40 via-fuchsia-400/30 to-orange-400/40 opacity-60 blur-[1px]"
              />
              <div className="rounded-2xl border border-white/10 bg-white/95 p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-8">
                <div className="flex flex-col gap-1.5">
                  <h2 className="text-balance text-2xl font-semibold tracking-tight text-slate-900">
                    Inicia sesión
                  </h2>
                  <p className="text-pretty text-sm leading-relaxed text-slate-600">
                    Correo electrónico y contraseña del alta.
                  </p>
                </div>

                <form className="mt-6 space-y-5" onSubmit={onSubmit}>
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                      Correo electrónico
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition-colors group-focus-within:text-[var(--primary)]">
                        <Mail size={16} aria-hidden />
                      </span>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="tu@empresa.com"
                        value={email}
                        onChange={(ev) => setEmail(ev.target.value)}
                        className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                      Contraseña
                    </label>
                    <div className="group relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 transition-colors group-focus-within:text-[var(--primary)]">
                        <KeyRound size={16} aria-hidden />
                      </span>
                      <input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(ev) => setPassword(ev.target.value)}
                        className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition-all placeholder:text-slate-400 hover:border-slate-400 focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary)]/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        required
                        minLength={8}
                      />
                    </div>
                  </div>

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
                    className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-slate-800 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-slate-900/30 active:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
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

            <p className="mt-6 text-center text-xs text-slate-400">
              &copy;{" "}
              <span suppressHydrationWarning>{new Date().getUTCFullYear()}</span> Finara
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
