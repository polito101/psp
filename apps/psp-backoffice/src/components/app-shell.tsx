import type { ReactNode } from "react";
import { Activity, Building2, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { id: "transactions", label: "Transacciones", icon: CreditCard, active: true },
  { id: "merchants", label: "Merchants", icon: Building2, active: false },
  { id: "health", label: "Health Proveedores", icon: Activity, active: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">PSP</p>
            <h1 className="text-lg font-semibold text-slate-900">Backoffice Administrativo</h1>
          </div>
          <div className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
            Entorno operativo
          </div>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-6 py-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white p-3">
          <nav className="space-y-1">
            {navItems.map(({ id, label, icon: Icon, active }) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-left",
                  active ? "bg-slate-900 text-slate-50" : "text-slate-600 hover:bg-slate-100",
                )}
                disabled={!active}
              >
                <Icon size={16} />
                <span>{label}</span>
                {!active ? (
                  <span className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 text-[10px]">
                    MVP+
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
