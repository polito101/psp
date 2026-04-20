import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as getSummary } from "@/app/api/internal/merchants/[merchantId]/finance/summary/route";
import { GET as getTransactions } from "@/app/api/internal/merchants/[merchantId]/finance/transactions/route";
import { GET as getPayouts } from "@/app/api/internal/merchants/[merchantId]/finance/payouts/route";

describe("merchant finance internal BFF routes", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("returns 401 for summary without backoffice credentials", async () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/merchants/m1/finance/summary");
    const res = await getSummary(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 for transactions without backoffice credentials", async () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest(
      "http://localhost:3005/api/internal/merchants/m1/finance/transactions?page=1",
    );
    const res = await getTransactions(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 401 for payouts without backoffice credentials", async () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest("http://localhost:3005/api/internal/merchants/m1/finance/payouts");
    const res = await getPayouts(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 for summary when currency is not uppercase ISO", async () => {
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";

    const req = new NextRequest(
      "http://localhost:3005/api/internal/merchants/m1/finance/summary?currency=eur",
      { headers: { Authorization: "Bearer admin-secret" } },
    );
    const res = await getSummary(req, { params: Promise.resolve({ merchantId: "m1" }) });
    expect(res.status).toBe(400);
  });
});
