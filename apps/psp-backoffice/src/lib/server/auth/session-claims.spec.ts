import { describe, it, expect } from "vitest";
import {
  signSession,
  verifySession,
  validateSessionClaims,
  assertScopeAccess,
  ForbiddenScopeError,
  truncateUtf8ToMaxBytes,
  MAX_REJECTION_REASON_JWT_UTF8_BYTES,
} from "./session-claims";

describe("session-claims", () => {
  const secret = "test-jwt-secret-at-least-32-chars!!";

  it("truncateUtf8ToMaxBytes leaves short strings unchanged", () => {
    expect(truncateUtf8ToMaxBytes("hola", 10)).toBe("hola");
  });

  it("truncateUtf8ToMaxBytes caps by UTF-8 bytes, not code units", () => {
    expect(truncateUtf8ToMaxBytes("a".repeat(100), 10)).toBe("a".repeat(10));
    const emoji = "😀"; // 4 bytes in UTF-8
    const out = truncateUtf8ToMaxBytes(emoji.repeat(300), 12);
    expect(new TextEncoder().encode(out).length).toBe(12);
    expect(out).toBe(emoji.repeat(3));
  });

  it("truncateUtf8ToMaxBytes does not split BMP+emoji surrogate pairs (no U+FFFD)", () => {
    const maxBytes = 768;
    const input = "a".repeat(765) + "😀";
    const out = truncateUtf8ToMaxBytes(input, maxBytes);
    expect(out).not.toContain("\uFFFD");
    expect(input.startsWith(out)).toBe(true);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(maxBytes);
    expect(out).toBe("a".repeat(765));
  });

  it("signSession stores rejectionReason truncated to max JWT UTF-8 bytes", async () => {
    const longReason = "🚫".repeat(2000);
    const claims = {
      sub: "merchant:mrc_x",
      role: "merchant" as const,
      merchantId: "mrc_x",
      onboardingStatus: "REJECTED" as const,
      rejectionReason: longReason,
    };
    const token = await signSession(claims, secret);
    const parsed = await verifySession(token, secret);
    expect(parsed.role).toBe("merchant");
    if (parsed.role !== "merchant") throw new Error("expected merchant");
    expect(new TextEncoder().encode(parsed.rejectionReason ?? "").length).toBeLessThanOrEqual(
      MAX_REJECTION_REASON_JWT_UTF8_BYTES,
    );
    expect(longReason.startsWith(parsed.rejectionReason ?? "")).toBe(true);
  });

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
