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
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayoutSession } from "@/lib/session-types";
import { getClientPortalLoginPath } from "@/lib/portal-mode";

type NavItem = {
  href: string;
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  activeMatch?: (pathname: string) => boolean;
};

function sessionBadgeLabel(session: LayoutSession | null): string {
  if (!session) return "Sin sesión";
  if (session.role === "merchant") return `Merchant · ${session.merchantId}`;
  return "Admin";
}

function buildNavItems(session: LayoutSession | null): NavItem[] {
  const loginHref = getClientPortalLoginPath();
  const financeHref =
    session?.role === "merchant" ? `/merchants/${session.merchantId}/finance` : "/merchants/lookup";

  if (session?.role === "merchant") {
    const mid = encodeURIComponent(session.merchantId);
    return [
      { href: "/", id: "home", label: "Inicio", icon: LayoutDashboard },
      { href: loginHref, id: "login", label: "Iniciar sesión", icon: LogIn },
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
    { href: loginHref, id: "login", label: "Iniciar sesión", icon: LogIn },
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
      href: "/crm/onboarding",
      id: "crm-onboarding",
      label: "CRM onboarding",
      icon: UserPlus,
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
  const loginHref = getClientPortalLoginPath();
  const navItems = buildNavItems(session);

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    router.push(loginHref);
    router.refresh();
  }

  const showLoginLink = !session && pathname !== loginHref;

  const isEntryPage = pathname === "/login" || pathname === "/admin/login";
  if (pathname.startsWith("/onboarding/")) {
    return <div className="min-h-screen">{children}</div>;
  }
  if (isEntryPage) {
    return <div className="min-h-screen bg-slate-50">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">PSP</p>
            <h1 className="text-lg font-semibold text-slate-900">Backoffice Administrativo</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
              {sessionBadgeLabel(session)}
            </div>
            <div className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
              Entorno operativo
            </div>
            <button
              type="button"
              onClick={logout}
              title="Elimina la cookie de sesión JWT (backoffice_session)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={14} aria-hidden />
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-[1400px] gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 lg:p-3">
          <nav className="flex gap-1 lg:block lg:space-y-1">
            {navItems.map((item) => {
              const { id, label, icon: Icon, href } = item;
              if (id === "login" && !showLoginLink) {
                return null;
              }
              const active =
                item.activeMatch != null
                  ? item.activeMatch(pathname)
                  : href === "/"
                    ? pathname === "/"
                    : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={id}
                  href={href}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap lg:w-full",
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
