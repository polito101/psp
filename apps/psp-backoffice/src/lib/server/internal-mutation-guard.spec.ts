import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { enforceInternalMutationRequest } from "./internal-mutation-guard";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3005/api/internal/test", {
    method: "POST",
    headers,
  });
}

function clearForwardedOriginTrustEnv(): void {
  delete process.env.TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS;
  delete process.env.VERCEL;
  delete process.env.CF_PAGES;
  delete process.env.RENDER;
}

describe("enforceInternalMutationRequest", () => {
  afterEach(() => {
    clearForwardedOriginTrustEnv();
  });

  it("rejects missing mutation header", () => {
    const result = enforceInternalMutationRequest(req());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("accepts explicit same-origin mutation header", () => {
    const result = enforceInternalMutationRequest(
      req({ "x-backoffice-mutation": "1", origin: "http://localhost:3005" }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects cross-origin requests", () => {
    clearForwardedOriginTrustEnv();
    const result = enforceInternalMutationRequest(
      req({ "x-backoffice-mutation": "1", origin: "https://evil.example" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("with forwarded-origin trust off, rejects Origin aligned only via spoofed X-Forwarded-Host", () => {
    clearForwardedOriginTrustEnv();
    const result = enforceInternalMutationRequest(
      new NextRequest("http://127.0.0.1:10000/api/internal/test", {
        method: "POST",
        headers: {
          "x-backoffice-mutation": "1",
          origin: "https://evil.attacker.example",
          host: "127.0.0.1:10000",
          "x-forwarded-host": "evil.attacker.example",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  describe("with TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS", () => {
    beforeEach(() => {
      clearForwardedOriginTrustEnv();
      process.env.TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS = "true";
    });

    it("accepts when Origin matches Host+X-Forwarded-Proto though nextUrl is internal (proxy TLS)", () => {
      const result = enforceInternalMutationRequest(
        new NextRequest("http://127.0.0.1:10000/api/internal/test", {
          method: "POST",
          headers: {
            "x-backoffice-mutation": "1",
            origin: "https://psp-backoffice-admin.onrender.com",
            host: "psp-backoffice-admin.onrender.com",
            "x-forwarded-proto": "https",
          },
        }),
      );
      expect(result.ok).toBe(true);
    });

    it("accepts last segment of comma-separated X-Forwarded-Proto", () => {
      const result = enforceInternalMutationRequest(
        new NextRequest("http://127.0.0.1:10000/api/internal/test", {
          method: "POST",
          headers: {
            "x-backoffice-mutation": "1",
            origin: "https://app.example.com",
            host: "app.example.com",
            "x-forwarded-proto": "http,https",
          },
        }),
      );
      expect(result.ok).toBe(true);
    });

    it("prefers X-Forwarded-Host last segment when Host is absent", () => {
      const result = enforceInternalMutationRequest(
        new NextRequest("http://127.0.0.1:10000/api/internal/test", {
          method: "POST",
          headers: {
            "x-backoffice-mutation": "1",
            origin: "https://public.example.com",
            "x-forwarded-host": "ignored.example.com, public.example.com",
            "x-forwarded-proto": "https",
          },
        }),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("with RENDER=true (implicit forwarded-origin trust)", () => {
    beforeEach(() => {
      clearForwardedOriginTrustEnv();
      process.env.RENDER = "true";
    });

    it("accepts Host+X-Forwarded-Proto without explicit TRUST_BACKOFFICE flag", () => {
      const result = enforceInternalMutationRequest(
        new NextRequest("http://127.0.0.1:10000/api/internal/test", {
          method: "POST",
          headers: {
            "x-backoffice-mutation": "1",
            origin: "https://app.render-hosted.example",
            host: "app.render-hosted.example",
            "x-forwarded-proto": "https",
          },
        }),
      );
      expect(result.ok).toBe(true);
    });
  });
});
