import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/session-cookie";

type ProxySession =
  | { role: "admin" }
  | { role: "merchant"; merchantId: string };

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
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
    });
    if (payload.role === "admin") {
      return { role: "admin" };
    }
    if (payload.role === "merchant" && typeof payload.merchantId === "string") {
      const merchantId = payload.merchantId.trim();
      if (merchantId) {
        return { role: "merchant", merchantId };
      }
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
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(ico|png|jpg|jpeg|gif|svg|webp|css|js|txt|map)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const session = await readSessionFromRequest(req);
  const hasSession = session !== null;

  if (!hasSession && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  if (session?.role === "merchant") {
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
