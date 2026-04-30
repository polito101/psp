import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getSummary } from "@/app/api/internal/merchants/[merchantId]/finance/summary/route";
import { GET as getTransactions } from "@/app/api/internal/merchants/[merchantId]/finance/transactions/route";
import { GET as getPayouts } from "@/app/api/internal/merchants/[merchantId]/finance/payouts/route";
import { mintTestAdminSessionJwt, mintTestMerchantSessionJwt } from "@/lib/server/test-session-jwt";

describe("merchant finance internal BFF routes", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("returns 401 for summary without backoffice credentials", async () => {
    const req = new NextRequest("http://localhost:3005/api/internal/merchants/m1/finance/summary");
    const res = await getSummary(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 for transactions without backoffice credentials", async () => {
    const req = new NextRequest(
      "http://localhost:3005/api/internal/merchants/m1/finance/transactions?page=1",
    );
    const res = await getTransactions(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 for payouts without backoffice credentials", async () => {
    const req = new NextRequest("http://localhost:3005/api/internal/merchants/m1/finance/payouts");
    const res = await getPayouts(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 for summary when currency is not uppercase ISO", async () => {
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
    const jwt = await mintTestAdminSessionJwt();
    const req = new NextRequest(
      "http://localhost:3005/api/internal/merchants/m1/finance/summary?currency=eur",
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    const res = await getSummary(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for summary when createdFrom is after createdTo", async () => {
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const qs =
      "currency=EUR&createdFrom=2026-04-30T00:00:00.000Z&createdTo=2026-04-01T00:00:00.000Z";
    const jwt = await mintTestAdminSessionJwt();
    const req = new NextRequest(`http://localhost:3005/api/internal/merchants/m1/finance/summary?${qs}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await getSummary(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 403 when merchant session requests another merchant summary", async () => {
    const jwt = await mintTestMerchantSessionJwt("mrc_1");
    const req = new NextRequest("http://localhost:3005/api/internal/merchants/mrc_2/finance/summary", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await getSummary(req, { params: Promise.resolve({ merchantId: "mrc_2" }) });
    expect(res.status).toBe(403);
  });
});
