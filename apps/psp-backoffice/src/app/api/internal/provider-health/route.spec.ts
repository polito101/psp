import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { mintTestMerchantSessionJwt } from "@/lib/server/test-session-jwt";

describe("GET /api/internal/provider-health", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.PSP_API_BASE_URL = "http://localhost:3003";
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("returns 403 for merchant session", async () => {
    const jwt = await mintTestMerchantSessionJwt("mrc_1");
    const req = new NextRequest("http://localhost:3005/api/internal/provider-health", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });
});
