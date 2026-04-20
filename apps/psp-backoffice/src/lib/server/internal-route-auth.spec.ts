import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { enforceInternalRouteAuth } from "./internal-route-auth";

describe("enforceInternalRouteAuth", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("returns 500 when BACKOFFICE_ADMIN_SECRET is missing (non-production)", () => {
    delete process.env.BACKOFFICE_ADMIN_SECRET;
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions");
    const res = enforceInternalRouteAuth(req);

    expect(res).not.toBeNull();
    expect(res?.status).toBe(500);
  });

  it("returns 500 when BACKOFFICE_ADMIN_SECRET equals PSP_INTERNAL_API_SECRET", () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "same-secret";
    process.env.PSP_INTERNAL_API_SECRET = "same-secret";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions");
    const res = enforceInternalRouteAuth(req);

    expect(res).not.toBeNull();
    expect(res?.status).toBe(500);
  });

  it("returns 401 without credentials when secrets are valid", () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions");
    const res = enforceInternalRouteAuth(req);

    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
    expect(res?.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("returns 403 when token does not match", () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions", {
      headers: { Authorization: "Bearer wrong" },
    });
    const res = enforceInternalRouteAuth(req);

    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it("allows the request when Bearer matches BACKOFFICE_ADMIN_SECRET", () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/transactions", {
      headers: { Authorization: "Bearer admin-secret" },
    });
    const res = enforceInternalRouteAuth(req);

    expect(res).toBeNull();
  });
});
