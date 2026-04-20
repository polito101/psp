import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  BACKOFFICE_ADMIN_COOKIE_NAME,
  validateAdminTokenForSession,
} from "@/lib/server/internal-route-auth";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const token =
    typeof body === "object" && body !== null && "token" in body && typeof (body as { token: unknown }).token === "string"
      ? (body as { token: string }).token.trim()
      : "";

  if (!token) {
    return NextResponse.json({ message: "Missing token" }, { status: 400 });
  }

  const validation = validateAdminTokenForSession(token);
  if (!validation.ok) {
    return validation.response;
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(BACKOFFICE_ADMIN_COOKIE_NAME, token, sessionCookieOptions());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(BACKOFFICE_ADMIN_COOKIE_NAME);
  return res;
}
