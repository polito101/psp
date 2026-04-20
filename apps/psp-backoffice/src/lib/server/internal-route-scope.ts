import { NextResponse } from "next/server";
import {
  assertScopeAccess,
  ForbiddenScopeError,
  type SessionClaims,
} from "@/lib/server/auth/session-claims";

export function forbiddenScopeResponse(): NextResponse {
  return NextResponse.json({ message: "Forbidden scope" }, { status: 403 });
}

/** Métricas / health globales: solo admin. */
export function requireAdminClaims(claims: SessionClaims): NextResponse | null {
  if (claims.role !== "admin") {
    return forbiddenScopeResponse();
  }
  return null;
}

export function enforceMerchantScope(
  claims: SessionClaims,
  targetMerchantId: string | undefined,
): NextResponse | null {
  try {
    assertScopeAccess(claims, targetMerchantId);
    return null;
  } catch (e) {
    if (e instanceof ForbiddenScopeError) {
      return forbiddenScopeResponse();
    }
    throw e;
  }
}
