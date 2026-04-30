import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/server/auth/session-claims";
import { proxy } from "./proxy";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/server/internal-route-auth";

describe("proxy (merchant portal)", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "merchant";
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("redirects unauthenticated users away from protected routes", async () => {
    const req = new NextRequest(new URL("http://localhost:3005/"));
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/login");
  });

  it("allows /login without session", async () => {
    const req = new NextRequest(new URL("http://localhost:3005/login"));
    const res = await proxy(req);
    expect(res?.status).toBe(200);
  });

  it("redirects /admin/login without session to /login", async () => {
    const req = new NextRequest(new URL("http://localhost:3005/admin/login"));
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/login");
  });

  it("redirects authenticated merchant away from /login", async () => {
    const jwt = await signSession(
      { sub: "m", role: "merchant", merchantId: "mrc_1" },
      process.env.BACKOFFICE_SESSION_JWT_SECRET!,
    );
    const req = new NextRequest(new URL("http://localhost:3005/login"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toMatch(/\/$/);
  });

  it("treats admin JWT as unauthenticated on merchant portal", async () => {
    const jwt = await signSession({ sub: "a", role: "admin" }, process.env.BACKOFFICE_SESSION_JWT_SECRET!);
    const req = new NextRequest(new URL("http://localhost:3005/"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/login");
  });

  it("redirects merchant away from /monitor", async () => {
    const jwt = await signSession(
      { sub: "m", role: "merchant", merchantId: "mrc_1" },
      process.env.BACKOFFICE_SESSION_JWT_SECRET!,
    );
    const req = new NextRequest(new URL("http://localhost:3005/monitor"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/");
  });

  it("redirects merchant from /merchants/lookup to own finance", async () => {
    const jwt = await signSession(
      { sub: "m", role: "merchant", merchantId: "mrc_1" },
      process.env.BACKOFFICE_SESSION_JWT_SECRET!,
    );
    const req = new NextRequest(new URL("http://localhost:3005/merchants/lookup"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/merchants/mrc_1/finance");
  });

  it("redirects merchant trying to access another merchant's finance to own finance", async () => {
    const jwt = await signSession(
      { sub: "m", role: "merchant", merchantId: "mrc_1" },
      process.env.BACKOFFICE_SESSION_JWT_SECRET!,
    );
    const req = new NextRequest(new URL("http://localhost:3005/merchants/mrc_other/finance"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/merchants/mrc_1/finance");
  });

  it("blocks merchant from /monitor sub-paths (not only the exact path)", async () => {
    const jwt = await signSession(
      { sub: "m", role: "merchant", merchantId: "mrc_1" },
      process.env.BACKOFFICE_SESSION_JWT_SECRET!,
    );
    const req = new NextRequest(new URL("http://localhost:3005/monitor/anything"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toMatch(/\/$/);
  });

  it("drops session when BACKOFFICE_SESSION_JWT_SECRET equals BACKOFFICE_ADMIN_SECRET (fail-closed)", async () => {
    process.env.BACKOFFICE_ADMIN_SECRET = process.env.BACKOFFICE_SESSION_JWT_SECRET;
    const jwt = await signSession({ sub: "a", role: "admin" }, process.env.BACKOFFICE_SESSION_JWT_SECRET!);
    const req = new NextRequest(new URL("http://localhost:3005/"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/login");
  });
});

describe("proxy (admin portal)", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    process.env.BACKOFFICE_PORTAL_MODE = "admin";
    process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE = "admin";
    process.env.BACKOFFICE_SESSION_JWT_SECRET = "session-jwt-secret-dev-only-32b";
    process.env.BACKOFFICE_ADMIN_SECRET = "admin-secret";
    process.env.PSP_INTERNAL_API_SECRET = "internal-only";
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("redirects unauthenticated users to /admin/login", async () => {
    const req = new NextRequest(new URL("http://localhost:3005/transactions"));
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/admin/login");
  });

  it("redirects /login without session to /admin/login", async () => {
    const req = new NextRequest(new URL("http://localhost:3005/login"));
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/admin/login");
  });

  it("allows /admin/login without session", async () => {
    const req = new NextRequest(new URL("http://localhost:3005/admin/login"));
    const res = await proxy(req);
    expect(res?.status).toBe(200);
  });

  it("redirects authenticated admin away from /admin/login", async () => {
    const jwt = await signSession({ sub: "a", role: "admin" }, process.env.BACKOFFICE_SESSION_JWT_SECRET!);
    const req = new NextRequest(new URL("http://localhost:3005/admin/login"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toMatch(/\/$/);
  });

  it("treats merchant JWT as unauthenticated on admin portal", async () => {
    const jwt = await signSession(
      { sub: "m", role: "merchant", merchantId: "mrc_1" },
      process.env.BACKOFFICE_SESSION_JWT_SECRET!,
    );
    const req = new NextRequest(new URL("http://localhost:3005/transactions"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/admin/login");
  });

  it("authenticated admin redirected from legacy /login to home", async () => {
    const jwt = await signSession({ sub: "a", role: "admin" }, process.env.BACKOFFICE_SESSION_JWT_SECRET!);
    const req = new NextRequest(new URL("http://localhost:3005/login"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, jwt);
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toMatch(/\/$/);
  });
});
