import { signSession } from "@/lib/server/auth/session-claims";

/** JWT admin para tests (requiere BACKOFFICE_SESSION_JWT_SECRET en env). */
export async function mintTestAdminSessionJwt(): Promise<string> {
  const secret = process.env.BACKOFFICE_SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error("BACKOFFICE_SESSION_JWT_SECRET required for test JWT");
  }
  return signSession({ sub: "admin:test", role: "admin" }, secret);
}

export async function mintTestMerchantSessionJwt(merchantId: string): Promise<string> {
  const secret = process.env.BACKOFFICE_SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error("BACKOFFICE_SESSION_JWT_SECRET required for test JWT");
  }
  const mid = merchantId.trim();
  return signSession(
    {
      sub: `merchant:${mid}`,
      role: "merchant",
      merchantId: mid,
      onboardingStatus: "ACTIVE",
      rejectionReason: null,
    },
    secret,
  );
}
