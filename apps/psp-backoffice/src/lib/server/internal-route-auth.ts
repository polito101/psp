import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  verifySession,
  type SessionClaims,
} from "@/lib/server/auth/session-claims";
import { getBackofficePortalMode, sessionRoleMatchesPortal } from "@/lib/server/portal-mode";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/session-cookie";

export { BACKOFFICE_SESSION_COOKIE_NAME };

export const BACKOFFICE_ADMIN_COOKIE_NAME = "backoffice_admin_token";

const AUTH_SCHEME = "Bearer";

/** Evita `Buffer.from` con cadenas enormes (DoS); secretos de entorno deben mantenerse por debajo. */
const MAX_SECURE_COMPARE_STRING_CHARS = 1024;

/** Límite del token admin en login público (alineado con el esquema Zod del route). */
export const MAX_ADMIN_SESSION_TOKEN_CHARS = 512;

function secureCompare(left: string, right: string): boolean {
  if (left.length > MAX_SECURE_COMPARE_STRING_CHARS || right.length > MAX_SECURE_COMPARE_STRING_CHARS) {
    return false;
  }
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

export function getSessionJwtSecret(): string {
  const sessionSecret = process.env.BACKOFFICE_SESSION_JWT_SECRET;
  if (!sessionSecret) {
    throw new Error("Missing BACKOFFICE_SESSION_JWT_SECRET in backoffice environment");
  }

  const pspInternalSecret = process.env.PSP_INTERNAL_API_SECRET;
  if (pspInternalSecret && secureCompare(sessionSecret, pspInternalSecret)) {
    throw new Error("BACKOFFICE_SESSION_JWT_SECRET must be different from PSP_INTERNAL_API_SECRET");
  }

  const adminSecret = process.env.BACKOFFICE_ADMIN_SECRET;
  if (adminSecret && secureCompare(sessionSecret, adminSecret)) {
    throw new Error("BACKOFFICE_SESSION_JWT_SECRET must be different from BACKOFFICE_ADMIN_SECRET");
  }

  return sessionSecret;
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

function getRequestSessionToken(request: NextRequest): string | null {
  const bearerToken = getBearerToken(request);
  if (bearerToken) {
    return bearerToken;
  }

  return request.cookies.get(BACKOFFICE_SESSION_COOKIE_NAME)?.value ?? null;
}

/** Para `POST /api/auth/session` modo admin: valida el token contra BACKOFFICE_ADMIN_SECRET. */
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

export type InternalRouteAuthResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; response: NextResponse };

export async function enforceInternalRouteAuth(request: NextRequest): Promise<InternalRouteAuthResult> {
  let sessionSecret: string;
  try {
    sessionSecret = getSessionJwtSecret();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ message: "Backoffice auth is misconfigured" }, { status: 500 }),
    };
  }

  const requestToken = getRequestSessionToken(request);
  if (!requestToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: "Missing backoffice credentials" },
        {
          status: 401,
          headers: { "WWW-Authenticate": `${AUTH_SCHEME} realm="backoffice-internal"` },
        },
      ),
    };
  }

  try {
    const claims = await verifySession(requestToken, sessionSecret);
    const portalMode = getBackofficePortalMode();
    if (!sessionRoleMatchesPortal(portalMode, claims.role)) {
      return {
        ok: false,
        response: NextResponse.json({ message: "Forbidden" }, { status: 403 }),
      };
    }
    if (claims.role === "merchant" && claims.onboardingStatus !== "ACTIVE") {
      return {
        ok: false,
        response: NextResponse.json({ message: "Merchant onboarding is not active" }, { status: 403 }),
      };
    }
    return { ok: true, claims };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ message: "Forbidden" }, { status: 403 }),
    };
  }
}
