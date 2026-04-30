import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { normalizeClientIp, resolveLoginRateLimitClientIp } from "./client-ip";

describe("normalizeClientIp", () => {
  it("accepts IPv4 and IPv6", () => {
    expect(normalizeClientIp(" 203.0.113.1 ")).toBe("203.0.113.1");
    expect(normalizeClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeClientIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("strips port from IPv4 and bracketed IPv6", () => {
    expect(normalizeClientIp("203.0.113.2:443")).toBe("203.0.113.2");
    expect(normalizeClientIp("[2001:db8::2]:8080")).toBe("2001:db8::2");
  });

  it("rejects invalid or oversized values", () => {
    expect(normalizeClientIp("not-an-ip")).toBeNull();
    expect(normalizeClientIp("")).toBeNull();
    expect(normalizeClientIp("a".repeat(50))).toBeNull();
  });
});

describe("resolveLoginRateLimitClientIp", () => {
  it("prefers x-vercel-forwarded-for over x-forwarded-for when both are valid", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-vercel-forwarded-for": "203.0.113.20",
        "x-forwarded-for": "198.51.100.1",
      }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("203.0.113.20");
  });

  it("falls back to x-forwarded-for when Vercel header is invalid", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-vercel-forwarded-for": "bogus",
        "x-forwarded-for": "198.51.100.2",
      }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("198.51.100.2");
  });

  it("returns null when no header yields a valid IP", () => {
    const req = new NextRequest("http://localhost/api/auth/session");
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });
});
