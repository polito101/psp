import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ADMIN_COOKIE_NAME = "backoffice_admin_token";
const AUTH_SCHEME = "Bearer";

function secureCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getAdminSecret(): string {
  const adminSecret = process.env.BACKOFFICE_ADMIN_SECRET;
  if (!adminSecret) {
    throw new Error("Missing BACKOFFICE_ADMIN_SECRET in backoffice environment");
  }

  const pspInternalSecret = process.env.PSP_INTERNAL_API_SECRET;
  if (pspInternalSecret && secureCompare(adminSecret, pspInternalSecret)) {
    throw new Error("BACKOFFICE_ADMIN_SECRET must be different from PSP_INTERNAL_API_SECRET");
  }

  return adminSecret;
}

function getBearerToken(request: NextRequest): string | null {
  const authorizationHeader = request.headers.get("authorization");
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== AUTH_SCHEME || !token) {
    return null;
  }

  return token.trim() || null;
}

function getRequestToken(request: NextRequest): string | null {
  const bearerToken = getBearerToken(request);
  if (bearerToken) {
    return bearerToken;
  }

  return request.cookies.get(ADMIN_COOKIE_NAME)?.value ?? null;
}

export function enforceInternalRouteAuth(request: NextRequest): NextResponse | null {
  let adminSecret: string;
  try {
    adminSecret = getAdminSecret();
  } catch {
    return NextResponse.json(
      { message: "Backoffice auth is misconfigured" },
      { status: 500 },
    );
  }

  const requestToken = getRequestToken(request);
  if (!requestToken) {
    return NextResponse.json(
      { message: "Missing backoffice credentials" },
      {
        status: 401,
        headers: { "WWW-Authenticate": `${AUTH_SCHEME} realm="backoffice-internal"` },
      },
    );
  }

  if (!secureCompare(requestToken, adminSecret)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  return null;
}
