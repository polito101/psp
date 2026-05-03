import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { enforceInternalMutationRequest } from "./internal-mutation-guard";

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3005/api/internal/test", {
    method: "POST",
    headers,
  });
}

describe("enforceInternalMutationRequest", () => {
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
    const result = enforceInternalMutationRequest(
      req({ "x-backoffice-mutation": "1", origin: "https://evil.example" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
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

  it("accepts first segment of comma-separated X-Forwarded-Proto", () => {
    const result = enforceInternalMutationRequest(
      new NextRequest("http://127.0.0.1:10000/api/internal/test", {
        method: "POST",
        headers: {
          "x-backoffice-mutation": "1",
          origin: "https://app.example.com",
          host: "app.example.com",
          "x-forwarded-proto": "https,http",
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});
