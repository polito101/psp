import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import {
  getBackofficePortalMode,
  getPortalLoginPath,
  sessionRoleMatchesPortal,
} from "@/lib/server/portal-mode";
import {
  isMerchantOnboardingSessionStatus,
  type MerchantOnboardingSessionStatus,
} from "@/lib/server/auth/session-claims";

type ProxySession =
  | { role: "admin" }
  | { role: "merchant"; merchantId: string; onboardingStatus: MerchantOnboardingSessionStatus };

function isDistinctSessionSecret(secret: string): boolean {
  const adminSecret = process.env.BACKOFFICE_ADMIN_SECRET;
  if (adminSecret && secret === adminSecret) {
    return false;
  }
  const internalSecret = process.env.PSP_INTERNAL_API_SECRET;
  if (internalSecret && secret === internalSecret) {
    return false;
  }
  return true;
}

async function readSessionFromRequest(req: NextRequest): Promise<ProxySession | null> {
  const token = req.cookies.get(BACKOFFICE_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  const secret = process.env.BACKOFFICE_SESSION_JWT_SECRET;
  if (!secret || !isDistinctSessionSecret(secret)) {
    return null;
  }

  const portalMode = getBackofficePortalMode();

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    if (payload.role === "admin") {
      if (!sessionRoleMatchesPortal(portalMode, "admin")) return null;
      return { role: "admin" };
    }
    if (payload.role === "merchant" && typeof payload.merchantId === "string") {
      if (!sessionRoleMatchesPortal(portalMode, "merchant")) return null;
      const merchantId = payload.merchantId.trim();
      const onboardingRaw = (payload as Record<string, unknown>)["onboardingStatus"];
      if (!merchantId || !isMerchantOnboardingSessionStatus(onboardingRaw)) {
        return null;
      }
      return { role: "merchant", merchantId, onboardingStatus: onboardingRaw };
    }
    return null;
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/onboarding/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(ico|png|jpg|jpeg|gif|svg|webp|css|js|txt|map)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const portalMode = getBackofficePortalMode();
  const loginPath = getPortalLoginPath(portalMode);
  const session = await readSessionFromRequest(req);
  const hasSession = session !== null;

  if (portalMode === "merchant" && pathname.startsWith("/admin")) {
    const dest = hasSession ? "/" : "/login";
    return NextResponse.redirect(new URL(dest, req.nextUrl));
  }

  if (portalMode === "admin" && pathname === "/login") {
    const dest = hasSession ? "/" : "/admin/login";
    return NextResponse.redirect(new URL(dest, req.nextUrl));
  }

  if (!hasSession && pathname !== loginPath) {
    return NextResponse.redirect(new URL(loginPath, req.nextUrl));
  }

  if (hasSession && (pathname === "/login" || pathname === "/admin/login")) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  if (pathname === "/merchant-status" && session?.role !== "merchant") {
    return NextResponse.redirect(new URL(hasSession ? "/" : loginPath, req.nextUrl));
  }

  if (session?.role === "merchant") {
    if (session.onboardingStatus !== "ACTIVE") {
      if (pathname !== "/merchant-status") {
        return NextResponse.redirect(new URL("/merchant-status", req.nextUrl));
      }
      return NextResponse.next();
    }
    if (pathname === "/merchant-status") {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    if (pathname === "/monitor" || pathname.startsWith("/monitor/")) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    if (pathname === "/merchants/lookup" || pathname.startsWith("/merchants/lookup/")) {
      return NextResponse.redirect(new URL(`/merchants/${session.merchantId}/finance`, req.nextUrl));
    }
    const financeMatch = pathname.match(/^\/merchants\/([^/]+)\/finance/);
    if (financeMatch && financeMatch[1] !== session.merchantId) {
      return NextResponse.redirect(new URL(`/merchants/${session.merchantId}/finance`, req.nextUrl));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
