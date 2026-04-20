import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const BACKOFFICE_ADMIN_COOKIE_NAME = "backoffice_admin_token";
const AUTH_SCHEME = "Bearer";

function secureCompare(left: string, right: string): boolean {
  const expectedBuf = Buffer.from(right);
  const providedBuf = Buffer.from(left);
  const sameLength = expectedBuf.length === providedBuf.length;
  const cmpBuf = sameLength ? providedBuf : Buffer.alloc(expectedBuf.length);
  const isEqual = timingSafeEqual(expectedBuf, cmpBuf);
  return sameLength && isEqual;
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

  return request.cookies.get(BACKOFFICE_ADMIN_COOKIE_NAME)?.value ?? null;
}

/** Para `POST /api/auth/session`: valida el token contra el secreto configurado. */
export function validateAdminTokenForSession(
  token: string,
):
  | { ok: true }
  | { ok: false; response: NextResponse } {
  let adminSecret: string;
  try {
    adminSecret = getAdminSecret();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ message: "Backoffice auth is misconfigured" }, { status: 500 }),
    };
  }

  if (!secureCompare(token.trim(), adminSecret)) {
    return {
      ok: false,
      response: NextResponse.json({ message: "Invalid credentials" }, { status: 401 }),
    };
  }

  return { ok: true };
}

export function enforceInternalRouteAuth(request: NextRequest): NextResponse | null {
  let adminSecret: string;
  try {
    adminSecret = getAdminSecret();
  } catch {
    return NextResponse.json({ message: "Backoffice auth is misconfigured" }, { status: 500 });
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
