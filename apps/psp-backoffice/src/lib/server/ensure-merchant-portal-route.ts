import { redirect } from "next/navigation";
import type { LayoutSession } from "@/lib/session-types";
import { getPortalLoginPath } from "@/lib/server/portal-mode";

/** Merchant solo su `merchantId`; admin cualquiera; sin sesión → login del portal según deploy. */
export function ensureMerchantPortalRoute(session: LayoutSession | null, merchantId: string): void {
  if (!session) {
    redirect(getPortalLoginPath());
  }
  if (session.role === "merchant" && session.merchantId !== merchantId) {
    redirect("/");
  }
}

export function ensureAdminRoute(session: LayoutSession | null): void {
  if (!session) {
    redirect(getPortalLoginPath());
  }
  if (session.role !== "admin") {
    redirect("/");
  }
}
