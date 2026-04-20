import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { BACKOFFICE_SESSION_COOKIE_NAME } from "@/lib/server/internal-route-auth";

describe("middleware", () => {
  it("redirects unauthenticated users away from protected routes", () => {
    const req = new NextRequest(new URL("http://localhost:3005/"));
    const res = middleware(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/login");
  });

  it("allows /login without session", () => {
    const req = new NextRequest(new URL("http://localhost:3005/login"));
    const res = middleware(req);
    expect(res?.status).toBe(200);
  });

  it("redirects authenticated user away from /login", () => {
    const req = new NextRequest(new URL("http://localhost:3005/login"));
    req.cookies.set(BACKOFFICE_SESSION_COOKIE_NAME, "fake-jwt");
    const res = middleware(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toMatch(/\/$/);
  });
});
