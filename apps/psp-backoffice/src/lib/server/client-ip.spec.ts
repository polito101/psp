import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  normalizeClientIp,
  resolveLoginRateLimitClientIp,
  resolveLoginRateLimitKey,
  computeLoginRateLimitKeyWithoutClientIp,
  LOGIN_RATE_LIMIT_UNRESOLVED_KEY,
  LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX,
} from "./client-ip";

function clearLoginRlIpEnv(): void {
  delete process.env.TRUST_X_FORWARDED_FOR;
  delete process.env.TRUST_PLATFORM_IP_HEADERS;
  delete process.env.TRUST_VERCEL_IP_HEADERS;
  delete process.env.TRUST_CLOUDFLARE_IP_HEADERS;
  delete process.env.VERCEL;
  delete process.env.CF_PAGES;
}

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
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    clearLoginRlIpEnv();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("ignores x-forwarded-for when TRUST_X_FORWARDED_FOR is not set (anti-spoof)", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "x-forwarded-for": "198.51.100.99" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });

  it("ignores x-real-ip when TRUST_X_FORWARDED_FOR is not set", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "x-real-ip": "198.51.100.88" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });

  it("ignores x-vercel-forwarded-for without VERCEL runtime or platform trust opt-in (anti-spoof)", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.20" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });

  it("ignores cf-connecting-ip without CF_PAGES runtime or platform trust opt-in (anti-spoof)", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "cf-connecting-ip": "203.0.113.30" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });

  it("uses x-real-ip when TRUST_X_FORWARDED_FOR is true", () => {
    process.env.TRUST_X_FORWARDED_FOR = "true";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "x-real-ip": "198.51.100.77" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("198.51.100.77");
  });

  it("prefers x-vercel-forwarded-for over x-forwarded-for when both are valid on Vercel", () => {
    process.env.VERCEL = "1";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-vercel-forwarded-for": "203.0.113.20",
        "x-forwarded-for": "198.51.100.1",
      }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("203.0.113.20");
  });

  it("falls back to x-forwarded-for when Vercel header is invalid and TRUST is set", () => {
    process.env.VERCEL = "1";
    process.env.TRUST_X_FORWARDED_FOR = "true";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-vercel-forwarded-for": "bogus",
        "x-forwarded-for": "198.51.100.2",
      }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("198.51.100.2");
  });

  it("picks first valid IP from a comma list when TRUST is set and earlier hops are invalid", () => {
    process.env.TRUST_X_FORWARDED_FOR = "true";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-forwarded-for": "not-an-ip, 198.51.100.3, 10.0.0.1",
      }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("198.51.100.3");
  });

  it("parses all segments of x-vercel-forwarded-for when VERCEL=1", () => {
    process.env.VERCEL = "1";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-vercel-forwarded-for": "bogus, 203.0.113.50",
        "x-forwarded-for": "10.0.0.1",
      }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("203.0.113.50");
  });

  it("uses cf-connecting-ip when CF_PAGES=1", () => {
    process.env.CF_PAGES = "1";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "cf-connecting-ip": "198.51.100.40" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBe("198.51.100.40");
  });

  it("TRUST_PLATFORM_IP_HEADERS enables both Vercel and CF client IP headers", () => {
    process.env.TRUST_PLATFORM_IP_HEADERS = "true";
    const reqVercel = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.99" }),
    });
    expect(resolveLoginRateLimitClientIp(reqVercel)).toBe("203.0.113.99");

    const reqCf = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "cf-connecting-ip": "198.51.100.41" }),
    });
    expect(resolveLoginRateLimitClientIp(reqCf)).toBe("198.51.100.41");
  });

  it("TRUST_VERCEL_IP_HEADERS does not trust cf-connecting-ip alone", () => {
    process.env.TRUST_VERCEL_IP_HEADERS = "true";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "cf-connecting-ip": "198.51.100.50" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });

  it("TRUST_CLOUDFLARE_IP_HEADERS does not trust x-vercel-forwarded-for alone", () => {
    process.env.TRUST_CLOUDFLARE_IP_HEADERS = "true";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.1" }),
    });
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });

  it("returns null when no header yields a valid IP", () => {
    const req = new NextRequest("http://localhost/api/auth/session");
    expect(resolveLoginRateLimitClientIp(req)).toBeNull();
  });
});

describe("resolveLoginRateLimitKey", () => {
  const snapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...snapshot };
    clearLoginRlIpEnv();
  });

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("uses unresolved sentinel when no IP and no fingerprint headers", () => {
    const req = new NextRequest("http://localhost/api/auth/session");
    expect(resolveLoginRateLimitKey(req)).toEqual([LOGIN_RATE_LIMIT_UNRESOLVED_KEY]);
  });

  it("uses fingerprint key plus global unresolved when no IP but User-Agent is set", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "user-agent": "Vitest-RL/1.0" }),
    });
    const keys = resolveLoginRateLimitKey(req);
    const fp = computeLoginRateLimitKeyWithoutClientIp("Vitest-RL/1.0", null);
    expect(keys).toEqual([fp, LOGIN_RATE_LIMIT_UNRESOLVED_KEY]);
    expect(keys[0].startsWith(LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX)).toBe(true);
  });

  it("does not use x-forwarded-for for rate limit key without TRUST (falls back to fingerprint when UA present)", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-forwarded-for": "198.51.100.7",
        "user-agent": "Mozilla/5.0 (test)",
      }),
    });
    const keys = resolveLoginRateLimitKey(req);
    expect(keys).not.toContain("198.51.100.7");
    expect(keys[0].startsWith(LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX)).toBe(true);
    expect(keys[1]).toBe(LOGIN_RATE_LIMIT_UNRESOLVED_KEY);
  });

  it("does not use spoofed platform headers for key without trust (fingerprint when UA present)", () => {
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({
        "x-vercel-forwarded-for": "198.51.100.8",
        "cf-connecting-ip": "198.51.100.9",
        "user-agent": "Mozilla/5.0 (spoof-test)",
      }),
    });
    const keys = resolveLoginRateLimitKey(req);
    expect(keys).not.toContain("198.51.100.8");
    expect(keys).not.toContain("198.51.100.9");
    expect(keys[0].startsWith(LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX)).toBe(true);
    expect(keys[1]).toBe(LOGIN_RATE_LIMIT_UNRESOLVED_KEY);
  });

  it("uses normalized IP from x-forwarded-for only when TRUST_X_FORWARDED_FOR is true", () => {
    process.env.TRUST_X_FORWARDED_FOR = "true";
    const req = new NextRequest("http://localhost/api/auth/session", {
      headers: new Headers({ "x-forwarded-for": "198.51.100.7" }),
    });
    expect(resolveLoginRateLimitKey(req)).toEqual(["198.51.100.7"]);
  });
});

describe("computeLoginRateLimitKeyWithoutClientIp", () => {
  it("returns sentinel when both UA and Accept-Language are empty", () => {
    expect(computeLoginRateLimitKeyWithoutClientIp(null, null)).toBe(LOGIN_RATE_LIMIT_UNRESOLVED_KEY);
    expect(computeLoginRateLimitKeyWithoutClientIp("   ", "")).toBe(LOGIN_RATE_LIMIT_UNRESOLVED_KEY);
  });

  it("returns fingerprint-prefixed key when User-Agent is present", () => {
    const k = computeLoginRateLimitKeyWithoutClientIp("Mozilla/5.0", null);
    expect(k.startsWith(LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX)).toBe(true);
    expect(k.length).toBe(LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX.length + 32);
  });

  it("differs for different User-Agent strings", () => {
    const a = computeLoginRateLimitKeyWithoutClientIp("Agent-A", "en");
    const b = computeLoginRateLimitKeyWithoutClientIp("Agent-B", "en");
    expect(a).not.toBe(b);
  });

  it("differs when only Accept-Language differs", () => {
    const a = computeLoginRateLimitKeyWithoutClientIp(null, "en-US");
    const b = computeLoginRateLimitKeyWithoutClientIp(null, "es-ES");
    expect(a).not.toBe(b);
  });
});
