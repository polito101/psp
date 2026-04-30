import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { signSession } from "@/lib/server/auth/session-claims";
import {
  BACKOFFICE_ADMIN_COOKIE_NAME,
  BACKOFFICE_SESSION_COOKIE_NAME,
  getSessionJwtSecret,
  MAX_ADMIN_SESSION_TOKEN_CHARS,
  MERCHANT_PORTAL_TOKEN_REGEX,
  validateAdminTokenForSession,
  validateMerchantPortalLogin,
} from "@/lib/server/internal-route-auth";
import { resolveLoginRateLimitKey } from "@/lib/server/client-ip";
import { checkLoginRateLimit } from "@/lib/server/login-rate-limit";
import { getBackofficePortalMode } from "@/lib/server/portal-mode";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

const loginBodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("admin"),
    token: z.string().min(1).max(MAX_ADMIN_SESSION_TOKEN_CHARS),
  }),
  z.object({
    mode: z.literal("merchant"),
    merchantId: z.string().trim().min(1).max(64),
    merchantToken: z.string().regex(MERCHANT_PORTAL_TOKEN_REGEX),
  }),
]);

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  };
}

export async function POST(request: NextRequest) {
  const rateLimit = checkLoginRateLimit(resolveLoginRateLimitKey(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Too many login attempts" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSec) } },
    );
  }

  let jwtSecret: string;
  try {
    jwtSecret = getSessionJwtSecret();
  } catch {
    return NextResponse.json({ message: "Backoffice auth is misconfigured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const parsed = loginBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const portalMode = getBackofficePortalMode();
  if (data.mode !== portalMode) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  let jwt: string;

  if (data.mode === "admin") {
    const validation = validateAdminTokenForSession(data.token.trim());
    if (!validation.ok) {
      return validation.response;
    }
    jwt = await signSession({ sub: "admin:session", role: "admin" }, jwtSecret);
  } else {
    const validation = validateMerchantPortalLogin(data.merchantId, data.merchantToken);
    if (!validation.ok) {
      return validation.response;
    }
    const merchantId = data.merchantId.trim();
    jwt = await signSession(
      { sub: `merchant:${merchantId}`, role: "merchant", merchantId },
      jwtSecret,
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt, sessionCookieOptions());
  res.cookies.delete(BACKOFFICE_ADMIN_COOKIE_NAME);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(BACKOFFICE_SESSION_COOKIE_NAME);
  res.cookies.delete(BACKOFFICE_ADMIN_COOKIE_NAME);
  return res;
}
