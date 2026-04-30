import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { ProxyUpstreamError } from "@/lib/server/backoffice-api";
import { mintTestAdminSessionJwt, mintTestMerchantSessionJwt } from "@/lib/server/test-session-jwt";

const proxyInternalGetMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/backoffice-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/backoffice-api")>();
  return {
    ...actual,
    proxyInternalGet: proxyInternalGetMock,
  };
});

import { GET } from "./route";

describe("GET /api/internal/payments/[paymentId]", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";
    proxyInternalGetMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("returns 404 for merchant when upstream responds 403 (no existence oracle)", async () => {
    proxyInternalGetMock.mockRejectedValue(new ProxyUpstreamError(403, "{}", false, 2));

    const jwt = await mintTestMerchantSessionJwt("mrc_1");
    const req = new NextRequest("http://localhost:3005/api/internal/payments/pay_123", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await GET(req, { params: Promise.resolve({ paymentId: "pay_123" }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Payment not found");
  });

  it("returns 404 for merchant when upstream 200 has a different merchantId (defense-in-depth)", async () => {
    proxyInternalGetMock.mockResolvedValue({
      id: "pay_123",
      merchantId: "mrc_other",
      status: "succeeded",
    });

    const jwt = await mintTestMerchantSessionJwt("mrc_1");
    const req = new NextRequest("http://localhost:3005/api/internal/payments/pay_123", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await GET(req, { params: Promise.resolve({ paymentId: "pay_123" }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Payment not found");
  });

  it("returns 200 with payload for merchant when merchantId matches", async () => {
    proxyInternalGetMock.mockResolvedValue({
      id: "pay_123",
      merchantId: "mrc_1",
      status: "succeeded",
    });

    const jwt = await mintTestMerchantSessionJwt("mrc_1");
    const req = new NextRequest("http://localhost:3005/api/internal/payments/pay_123", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await GET(req, { params: Promise.resolve({ paymentId: "pay_123" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; merchantId: string };
    expect(body.merchantId).toBe("mrc_1");
  });

  it("returns upstream 403 for admin when API responds 403", async () => {
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
    proxyInternalGetMock.mockRejectedValue(
      new ProxyUpstreamError(403, JSON.stringify({ message: "Forbidden", statusCode: 403 }), false, 40),
    );

    const jwt = await mintTestAdminSessionJwt();
    const req = new NextRequest("http://localhost:3005/api/internal/payments/pay_123", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await GET(req, { params: Promise.resolve({ paymentId: "pay_123" }) });
    expect(res.status).toBe(403);
  });
});
