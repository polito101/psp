import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export type SessionClaims =
  | { sub: string; role: "admin" }
  | { sub: string; role: "merchant"; merchantId: string };

export class ForbiddenScopeError extends Error {
  constructor(message = "FORBIDDEN_SCOPE") {
    super(message);
    this.name = "ForbiddenScopeError";
  }
}

/**
 * Valida un objeto de claims (p. ej. tras verificar JWT).
 * @throws Error si el rol merchant no incluye merchantId
 */
export function validateSessionClaims(raw: unknown): SessionClaims {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid session claims");
  }
  const o = raw as Record<string, unknown>;
  const sub = typeof o.sub === "string" ? o.sub : "";
  if (!sub) {
    throw new Error("Invalid session claims: missing sub");
  }
  const role = o.role;
  if (role === "admin") {
    return { sub, role: "admin" };
  }
  if (role === "merchant") {
    const merchantId = typeof o.merchantId === "string" ? o.merchantId.trim() : "";
    if (!merchantId) {
      throw new Error("Invalid session claims: merchantId required for merchant role");
    }
    return { sub, role: "merchant", merchantId };
  }
  throw new Error("Invalid session claims: role must be admin or merchant");
}

export function claimsFromJwtPayload(payload: JWTPayload): SessionClaims {
  const merchantId =
    typeof payload.merchantId === "string"
      ? payload.merchantId
      : typeof (payload as Record<string, unknown>)["merchant_id"] === "string"
        ? String((payload as Record<string, unknown>)["merchant_id"])
        : undefined;

  const role = payload.role;
  const sub = typeof payload.sub === "string" ? payload.sub : "";

  if (role === "admin") {
    return validateSessionClaims({ sub, role: "admin" });
  }
  if (role === "merchant") {
    return validateSessionClaims({ sub, role: "merchant", merchantId: merchantId ?? "" });
  }
  throw new Error("Invalid session token payload");
}

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  validateSessionClaims(claims);
  const key = new TextEncoder().encode(secret);
  const jwt = new SignJWT({
    role: claims.role,
    ...(claims.role === "merchant" ? { merchantId: claims.merchantId } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
  return jwt;
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
  return claimsFromJwtPayload(payload);
}

/**
 * Admin: sin restricción. Merchant: solo si `targetMerchantId` coincide con su merchantId.
 */
export function assertScopeAccess(claims: SessionClaims, targetMerchantId?: string): void {
  if (claims.role === "admin") {
    return;
  }
  if (!targetMerchantId || claims.merchantId !== targetMerchantId) {
    throw new ForbiddenScopeError();
  }
}
