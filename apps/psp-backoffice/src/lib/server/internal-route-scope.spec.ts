import { describe, it, expect } from "vitest";
import { enforceMerchantScope, requireAdminClaims } from "./internal-route-scope";

describe("internal-route-scope", () => {
  it("requireAdminClaims rejects merchant", () => {
    const res = requireAdminClaims({
      sub: "m",
      role: "merchant",
      merchantId: "m1",
      onboardingStatus: "ACTIVE",
      rejectionReason: null,
    });
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it("enforceMerchantScope rejects cross-merchant", () => {
    const res = enforceMerchantScope(
      {
        sub: "m",
        role: "merchant",
        merchantId: "m1",
        onboardingStatus: "ACTIVE",
        rejectionReason: null,
      },
      "m2",
    );
    expect(res?.status).toBe(403);
  });

  it("enforceMerchantScope allows admin without target", () => {
    expect(enforceMerchantScope({ sub: "a", role: "admin" }, undefined)).toBeNull();
  });
});
