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
});
