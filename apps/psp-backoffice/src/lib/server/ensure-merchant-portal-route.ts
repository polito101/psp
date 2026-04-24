import { redirect } from "next/navigation";
import type { LayoutSession } from "@/lib/session-types";

/** Merchant solo su `merchantId`; admin cualquiera; sin sesión → login. */
export function ensureMerchantPortalRoute(session: LayoutSession | null, merchantId: string): void {
  if (!session) {
    redirect("/login");
  }
  if (session.role === "merchant" && session.merchantId !== merchantId) {
    redirect("/");
  }
}

export function ensureAdminRoute(session: LayoutSession | null): void {
  if (!session) {
    redirect("/login");
  }
  if (session.role !== "admin") {
    redirect("/");
  }
}
