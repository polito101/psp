import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { POST } from "./route";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/server/internal-route-auth";

describe("POST /api/auth/session", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_MERCHANT_PORTAL_SECRET = "portal-hmac-secret-32bytes!!";
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("creates admin session JWT in HttpOnly cookie", async () => {
    const req = new NextRequest("http://localhost:3005/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "admin", token: "admin-secret" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const raw = res.headers.get("set-cookie") ?? "";
    expect(raw).toContain(BACKOFFICE_SESSION_COOKIE_NAME);
    expect(raw.toLowerCase()).toContain("httponly");
  });

  it("creates merchant session with merchantId in JWT", async () => {
    const mid = "mrc_test";
    const token = createHmac("sha256", process.env.BACKOFFICE_MERCHANT_PORTAL_SECRET!)
      .update(mid, "utf8")
      .digest("hex");
    const req = new NextRequest("http://localhost:3005/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "merchant", merchantId: mid, merchantToken: token }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const raw = res.headers.get("set-cookie") ?? "";
    const match = raw.match(new RegExp(`${BACKOFFICE_SESSION_COOKIE_NAME}=([^;]+)`));
    expect(match).toBeTruthy();
    const jwtValue = decodeURIComponent(match![1]);
    const { payload } = await jwtVerify(
      jwtValue,
      new TextEncoder().encode(process.env.BACKOFFICE_SESSION_JWT_SECRET!),
      { algorithms: ["HS256"] },
    );
    expect(payload.role).toBe("merchant");
    expect(payload.merchantId).toBe(mid);
  });
});
