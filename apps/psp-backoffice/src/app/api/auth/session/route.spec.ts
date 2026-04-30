import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { POST } from "./route";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/server/internal-route-auth";
import { resetLoginRateLimitForTests } from "@/lib/server/login-rate-limit";

describe("POST /api/auth/session (admin portal)", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    resetLoginRateLimitForTests();
    process.env = { ...snapshot };
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
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

  it("rejects admin token longer than MAX_ADMIN_SESSION_TOKEN_CHARS", async () => {
    const req = new NextRequest("http://localhost:3005/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "admin", token: "x".repeat(513) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 for merchant login body on admin portal", async () => {
    const mid = "mrc_test";
    const exp = Math.floor(Date.now() / 1000);
    const signingInput = `${mid}.${exp}`;
    const sig = createHmac("sha256", process.env.BACKOFFICE_MERCHANT_PORTAL_SECRET!)
      .update(signingInput, "utf8")
      .digest("hex");
    const merchantToken = `${exp}:${sig}`;
    const req = new NextRequest("http://localhost:3005/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "merchant", merchantId: mid, merchantToken }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("does not apply shared rate limit when no client IP can be resolved", async () => {
    for (let i = 0; i < 12; i += 1) {
      const res = await POST(
        new NextRequest("http://localhost:3005/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "admin", token: "admin-secret" }),
        }),
      );
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 after too many login attempts from the same resolved IP", async () => {
    const headersBase = {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    };
    const body = JSON.stringify({ mode: "admin", token: "admin-secret" });
    for (let i = 0; i < 10; i += 1) {
      const res = await POST(
        new NextRequest("http://localhost:3005/api/auth/session", {
          method: "POST",
          headers: headersBase,
          body,
        }),
      );
      expect(res.status).toBe(200);
    }
    const resBlocked = await POST(
      new NextRequest("http://localhost:3005/api/auth/session", {
        method: "POST",
        headers: headersBase,
        body,
      }),
    );
    expect(resBlocked.status).toBe(429);
  });
});

describe("POST /api/auth/session (merchant portal)", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    resetLoginRateLimitForTests();
    process.env = { ...snapshot };
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
    process.env.BACKOFFICE_MERCHANT_PORTAL_SECRET = "portal-hmac-secret-32bytes!!";
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("rejects merchant token that does not match exp:hex64 format", async () => {
    const req = new NextRequest("http://localhost:3005/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "merchant",
        merchantId: "mrc_test",
        merchantToken: "a".repeat(10_000),
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates merchant session with merchantId in JWT", async () => {
    const mid = "mrc_test";
    const exp = Math.floor(Date.now() / 1000);
    const signingInput = `${mid}.${exp}`;
    const sig = createHmac("sha256", process.env.BACKOFFICE_MERCHANT_PORTAL_SECRET!)
      .update(signingInput, "utf8")
      .digest("hex");
    const merchantToken = `${exp}:${sig}`;
    const req = new NextRequest("http://localhost:3005/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "merchant", merchantId: mid, merchantToken }),
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

  it("returns 404 for admin login body on merchant portal", async () => {
    const req = new NextRequest("http://localhost:3005/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "admin", token: "admin-secret" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
