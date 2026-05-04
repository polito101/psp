import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { mintTestAdminSessionJwt } from "@/lib/server/test-session-jwt";

const proxyInternalPatchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/backoffice-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/backoffice-api")>();
  return {
    ...actual,
    proxyInternalPatch: proxyInternalPatchMock,
  };
});

import { PATCH } from "./route";

describe("PATCH /api/internal/merchants/ops/[merchantId]/account", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
    proxyInternalPatchMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  async function adminPatchRequest(
    path: string,
    body: Record<string, unknown>,
  ): Promise<NextRequest> {
    const jwt = await mintTestAdminSessionJwt();
    return new NextRequest(path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Backoffice-Mutation": "1",
        Origin: "http://localhost:3005",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 for invalid account body", async () => {
    const req = await adminPatchRequest("http://localhost:3005/api/internal/merchants/ops/m_123/account", {
      email: "not-email",
    });
    const res = await PATCH(req, { params: Promise.resolve({ merchantId: "m_123" }) });
    expect(res.status).toBe(400);
    expect(proxyInternalPatchMock).not.toHaveBeenCalled();
  });

  it("proxies valid PATCH to PSP API", async () => {
    proxyInternalPatchMock.mockResolvedValue({
      id: "m_1",
      mid: "123456",
      name: "Levels Ltd",
      email: "support@levels.test",
      isActive: true,
    });

    const req = await adminPatchRequest("http://localhost:3005/api/internal/merchants/ops/m_123/account", {
      name: "Levels Ltd",
      email: "support@levels.test",
      contactName: "Support Team",
      contactPhone: "+34600000000",
      websiteUrl: null,
      isActive: true,
      registrationStatus: "LEAD",
      registrationNumber: "2024-00069",
      industry: "FOREX",
    });
    const res = await PATCH(req, { params: Promise.resolve({ merchantId: "m_123" }) });
    expect(res.status).toBe(200);

    expect(proxyInternalPatchMock).toHaveBeenCalledWith({
      path: "/api/v1/merchants/ops/m_123/account",
      body: {
        name: "Levels Ltd",
        email: "support@levels.test",
        contactName: "Support Team",
        contactPhone: "+34600000000",
        websiteUrl: null,
        isActive: true,
        registrationStatus: "LEAD",
        registrationNumber: "2024-00069",
        industry: "FOREX",
      },
      backofficeScope: expect.objectContaining({ role: "admin" }),
    });
  });
});
