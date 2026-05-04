import { cookies } from "next/headers";
import { verifySession } from "@/lib/server/auth/session-claims";
import type { LayoutSession } from "@/lib/session-types";
import {
  BACKOFFICE_SESSION_COOKIE_NAME,
  getSessionJwtSecret,
} from "@/lib/server/internal-route-auth";
import { getBackofficePortalMode, sessionRoleMatchesPortal } from "@/lib/server/portal-mode";

export type { LayoutSession } from "@/lib/session-types";

/**
 * Lee la sesión JWT desde cookies (Server Components / layout).
 * Si falta secreto o el token es inválido, devuelve `null`.
 */
export async function readLayoutSessionFromCookies(): Promise<LayoutSession | null> {
  try {
    const secret = getSessionJwtSecret();
    const cookieStore = await cookies();
    const token = cookieStore.get(BACKOFFICE_SESSION_COOKIE_NAME)?.value;
    if (!token) {
      return null;
    }
    const claims = await verifySession(token, secret);
    const portalMode = getBackofficePortalMode();
    if (!sessionRoleMatchesPortal(portalMode, claims.role)) {
      return null;
    }
    if (claims.role === "admin") {
      return { role: "admin" };
    }
    return {
      role: "merchant",
      merchantId: claims.merchantId,
      onboardingStatus: claims.onboardingStatus,
      rejectionReason: claims.rejectionReason,
    };
  } catch {
    return null;
  }
}
