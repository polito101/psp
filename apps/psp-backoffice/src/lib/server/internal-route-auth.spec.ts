import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/server/auth/session-claims";
import { enforceInternalRouteAuth, validateAdminTokenForSession } from "./internal-route-auth";

async function mintAdminJwt(): Promise<string> {
  return signSession({ sub: "admin:session", role: "admin" }, process.env.BACKOFFICE_SESSION_JWT_SECRET!);
}

describe("enforceInternalRouteAuth", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("returns 500 when BACKOFFICE_SESSION_JWT_SECRET is missing", async () => {
    delete process.env.BACKOFFICE_SESSION_JWT_SECRET;
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions");
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(500);
  });

  it("returns 500 when BACKOFFICE_SESSION_JWT_SECRET equals PSP_INTERNAL_API_SECRET", async () => {
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "same-secret";
    process.env.PSP_INTERNAL_API_SECRET = "same-secret";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions");
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(500);
  });

  it("returns 401 without credentials when secrets are valid", async () => {
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions");
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(401);
      expect(res.response.headers.get("WWW-Authenticate")).toContain("Bearer");
    }
  });

  it("returns 403 when token is not a valid JWT", async () => {
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions", {
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("allows the request when Bearer is a valid admin session JWT", async () => {
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_PORTAL_MODE = "admin";

    const jwt = await mintAdminJwt();
    const req = new NextRequest("http://localhost:3005/api/internal/transactions", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claims.role).toBe("admin");
    }
  });

  it("returns 403 when admin JWT is presented on merchant portal", async () => {
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";

    const jwt = await mintAdminJwt();
    const req = new NextRequest("http://localhost:3005/api/internal/transactions", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("returns 403 when merchant JWT is presented on admin portal", async () => {
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";

    const jwt = await signSession(
      {
        sub: "merchant:m1",
        role: "merchant",
        merchantId: "m1",
        onboardingStatus: "ACTIVE",
        rejectionReason: null,
      },
      process.env.BACKOFFICE_SESSION_JWT_SECRET,
    );
    const req = new NextRequest("http://localhost:3005/api/internal/transactions", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("returns 403 when merchant JWT onboarding is not ACTIVE", async () => {
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";

    const jwt = await signSession(
      {
        sub: "merchant:m1",
        role: "merchant",
        merchantId: "m1",
        onboardingStatus: "DOCUMENTATION_PENDING",
        rejectionReason: null,
      },
      process.env.BACKOFFICE_SESSION_JWT_SECRET,
    );
    const req = new NextRequest("http://localhost:3005/api/internal/transactions", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await enforceInternalRouteAuth(req);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });
});

describe("validateAdminTokenForSession", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("returns ok when token matches BACKOFFICE_ADMIN_SECRET", () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    expect(validateAdminTokenForSession("admin-secret")).toEqual({ ok: true });
  });

  it("returns 401 response when token does not match", () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const result = validateAdminTokenForSession("wrong");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 401 when token exceeds secure compare max length (no huge Buffer)", () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const result = validateAdminTokenForSession("z".repeat(2000));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });
});
