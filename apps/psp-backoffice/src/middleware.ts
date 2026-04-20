import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/server/internal-route-auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(ico|png|jpg|jpeg|gif|svg|webp|css|js|txt|map)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get(BACKOFFICE_SESSION_COOKIE_NAME)?.value);

  if (!hasSession && pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
