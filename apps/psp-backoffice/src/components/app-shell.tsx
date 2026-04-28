"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Building2,
  ClipboardList,
  CreditCard,
  Landmark,
  LayoutDashboard,
  LogIn,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayoutSession } from "@/lib/session-types";

type NavItem = {
  href: string | null;
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  activeMatch?: (pathname: string) => boolean;
};

function buildNavItems(session: LayoutSession | null): NavItem[] {
  const financeHref =
    session?.role === "merchant" ? `/merchants/${session.merchantId}/finance` : "/merchants/lookup";

  if (session?.role === "merchant") {
    const mid = encodeURIComponent(session.merchantId);
    return [
      { href: "/", id: "home", label: "Inicio", icon: LayoutDashboard },
      { href: "/login", id: "login", label: "Iniciar sesión", icon: LogIn },
      { href: "/transactions", id: "transactions", label: "Transacciones", icon: CreditCard },
      {
        href: `/merchants/${mid}/overview`,
        id: "merchant-portal",
        label: "Mi comercio",
        icon: Building2,
        activeMatch: (pathname: string) => pathname.startsWith(`/merchants/${session.merchantId}/`),
      },
      {
        href: financeHref,
        id: "merchant-finance",
        label: "Finanzas",
        icon: Landmark,
        activeMatch: (pathname: string) => /^\/merchants\/[^/]+\/finance/.test(pathname),
      },
    ];
  }

  const base: NavItem[] = [
    { href: "/", id: "home", label: "Inicio", icon: LayoutDashboard },
    { href: "/login", id: "login", label: "Iniciar sesión", icon: LogIn },
    { href: "/transactions", id: "transactions", label: "Transacciones", icon: CreditCard },
    {
      href: "/merchants",
      id: "merchants-directory",
      label: "Merchants",
      icon: Building2,
      activeMatch: (pathname: string) =>
        pathname === "/merchants" || /^\/merchants\/[^/]+\/(overview|payments|settlements|payment-methods|admin)/.test(pathname),
    },
    {
      href: "/operations",
      id: "operations",
      label: "Operaciones",
      icon: ClipboardList,
    },
    {
      href: financeHref,
      id: "merchant-finance-lookup",
      label: "Finanzas merchant",
      icon: Landmark,
      activeMatch: (pathname: string) =>
        pathname === "/merchants/lookup" || /^\/merchants\/[^/]+\/finance/.test(pathname),
    },
    { href: "/monitor", id: "monitor", label: "Monitor operativo (API)", icon: Activity },
  ];

  return base;
}

export function AppShell({
  children,
  session,
}: {
  children: ReactNode;
  session: LayoutSession | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = buildNavItems(session);

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    router.push("/login");
    router.refresh();
  }

  const showLoginLink = !session && pathname !== "/login";

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">PSP</p>
            <h1 className="text-lg font-semibold text-slate-900">Backoffice Administrativo</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
              Entorno operativo
            </div>
            {pathname === "/login" ? null : (
              <button
                type="button"
                onClick={logout}
                title="Elimina la cookie de sesión JWT (backoffice_session)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <LogOut size={14} aria-hidden />
                Cerrar sesión
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-6 py-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white p-3">
          <nav className="space-y-1">
            {navItems.map((item) => {
              const { id, label, icon: Icon, href } = item;
              if (id === "login" && !showLoginLink) {
                return null;
              }
              const active =
                href != null &&
                ("activeMatch" in item && item.activeMatch
                  ? item.activeMatch(pathname)
                  : href === "/"
                    ? pathname === "/"
                    : pathname === href || pathname.startsWith(`${href}/`));
              if (!href) {
                return (
                  <button
                    key={id}
                    type="button"
                    disabled
                    className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-400"
                  >
                    <Icon size={16} />
                    <span>{label}</span>
                    <span className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">
                      MVP+
                    </span>
                  </button>
                );
              }
              return (
                <Link
                  key={id}
                  href={href}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
                    active ? "bg-[var(--primary)] text-white" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  <Icon size={16} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
