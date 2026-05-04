import { describe, it, expect } from "vitest";
import {
  signSession,
  verifySession,
  validateSessionClaims,
  assertScopeAccess,
  ForbiddenScopeError,
} from "./session-claims";

describe("session-claims", () => {
  const secret = "test-jwt-secret-at-least-32-chars!!";

  it("accepts admin session claim", async () => {
    const claims = { sub: "admin:ops", role: "admin" as const };
    const token = await signSession(claims, secret);
    const parsed = await verifySession(token, secret);
    expect(parsed.role).toBe("admin");
  });

  it("rejects merchant without merchantId", () => {
    const bad = { sub: "merchant:1", role: "merchant" as const };
    expect(() => validateSessionClaims(bad)).toThrow(/merchantId/);
  });

  it("assertScopeAccess allows admin for any merchant", () => {
    expect(() =>
      assertScopeAccess({ sub: "a", role: "admin" }, "mrc_any"),
    ).not.toThrow();
  });

  it("assertScopeAccess allows merchant for own id", () => {
    expect(() =>
      assertScopeAccess(
        {
          sub: "m",
          role: "merchant",
          merchantId: "mrc_1",
          onboardingStatus: "ACTIVE",
          rejectionReason: null,
        },
        "mrc_1",
      ),
    ).not.toThrow();
  });

  it("assertScopeAccess forbids merchant for other id", () => {
    expect(() =>
      assertScopeAccess(
        {
          sub: "m",
          role: "merchant",
          merchantId: "mrc_1",
          onboardingStatus: "ACTIVE",
          rejectionReason: null,
        },
        "mrc_2",
      ),
    ).toThrow(ForbiddenScopeError);
  });
});
