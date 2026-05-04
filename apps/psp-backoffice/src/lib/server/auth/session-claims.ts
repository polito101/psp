import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Techo de bytes UTF-8 para `rejectionReason` dentro del JWT de cookie.
 * Las cookies suelen limitarse ~4096 B; el payload ya incluye sub, merchantId, claims y la firma.
 */
export const MAX_REJECTION_REASON_JWT_UTF8_BYTES = 768;

/**
 * Recorta `input` al máximo de bytes UTF-8 sin partir una secuencia multibyte.
 */
export function truncateUtf8ToMaxBytes(input: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(input).length <= maxBytes) {
    return input;
  }
  let low = 0;
  let high = input.length;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const slice = input.slice(0, mid);
    const len = encoder.encode(slice).length;
    if (len <= maxBytes) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return input.slice(0, best);
}

/** Alineado con `MerchantOnboardingStatus` en la API (expediente del merchant). */
export type MerchantOnboardingSessionStatus =
  | "ACCOUNT_CREATED"
  | "DOCUMENTATION_PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "ACTIVE";

const MERCHANT_ONBOARDING_STATUSES: ReadonlySet<string> = new Set([
  "ACCOUNT_CREATED",
  "DOCUMENTATION_PENDING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "ACTIVE",
]);

export function isMerchantOnboardingSessionStatus(
  value: unknown,
): value is MerchantOnboardingSessionStatus {
  return typeof value === "string" && MERCHANT_ONBOARDING_STATUSES.has(value);
}

export type SessionClaims =
  | { sub: string; role: "admin" }
  | {
      sub: string;
      role: "merchant";
      merchantId: string;
      onboardingStatus: MerchantOnboardingSessionStatus;
      rejectionReason: string | null;
    };

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
    const onboardingStatusRaw = o.onboardingStatus;
    if (!isMerchantOnboardingSessionStatus(onboardingStatusRaw)) {
      throw new Error("Invalid session claims: onboardingStatus required for merchant role");
    }
    let rejectionReason: string | null = null;
    if (o.rejectionReason !== undefined && o.rejectionReason !== null) {
      if (typeof o.rejectionReason !== "string") {
        throw new Error("Invalid session claims: rejectionReason must be string or null");
      }
      rejectionReason = o.rejectionReason;
    } else if (o.rejectionReason === null) {
      rejectionReason = null;
    }
    return { sub, role: "merchant", merchantId, onboardingStatus: onboardingStatusRaw, rejectionReason };
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
    const onboardingStatus = (payload as Record<string, unknown>)["onboardingStatus"];
    const rejectionReasonRaw = (payload as Record<string, unknown>)["rejectionReason"];
    return validateSessionClaims({
      sub,
      role: "merchant",
      merchantId: merchantId ?? "",
      onboardingStatus,
      ...(rejectionReasonRaw !== undefined ? { rejectionReason: rejectionReasonRaw } : {}),
    });
  }
  throw new Error("Invalid session token payload");
}

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  validateSessionClaims(claims);
  const key = new TextEncoder().encode(secret);
  const jwt = new SignJWT({
    role: claims.role,
    ...(claims.role === "merchant"
      ? {
          merchantId: claims.merchantId,
          onboardingStatus: claims.onboardingStatus,
          rejectionReason:
            claims.rejectionReason === null
              ? null
              : truncateUtf8ToMaxBytes(
                  claims.rejectionReason,
                  MAX_REJECTION_REASON_JWT_UTF8_BYTES,
                ),
        }
      : {}),
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
