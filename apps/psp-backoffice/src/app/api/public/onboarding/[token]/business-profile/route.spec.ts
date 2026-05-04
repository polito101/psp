import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { ProxyUpstreamError } from "@/lib/server/backoffice-api";

const proxyPublicPostMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/backoffice-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/backoffice-api")>();
  return {
    ...actual,
    proxyPublicPost: proxyPublicPostMock,
  };
});

import { POST } from "./route";

describe("POST /api/public/onboarding/[token]/business-profile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    proxyPublicPostMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid business profile body", async () => {
    const req = new NextRequest(
      "http://localhost:3005/api/public/onboarding/tok_123/business-profile",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: "A", industry: "FOREX" }),
      },
    );

    const res = await POST(req, { params: Promise.resolve({ token: "tok_123" }) });

    expect(res.status).toBe(400);
    expect(proxyPublicPostMock).not.toHaveBeenCalled();
  });

  it("valid body calls the public proxy with normalized payload", async () => {
    proxyPublicPostMock.mockResolvedValue({ id: "app_123", status: "IN_REVIEW" });
    const req = new NextRequest(
      "http://localhost:3005/api/public/onboarding/tok_123/business-profile",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: "Ada Shop",
          industry: "FOREX",
          websiteUrl: "",
        }),
      },
    );

    const res = await POST(req, { params: Promise.resolve({ token: "tok_123" }) });

    expect(res.status).toBe(200);
    expect(proxyPublicPostMock).toHaveBeenCalledWith({
      path: "/api/v1/merchant-onboarding/tokens/tok_123/business-profile",
      body: {
        companyName: "Ada Shop",
        industry: "FOREX",
        websiteUrl: undefined,
      },
    });
  });

  it("maps upstream errors to safe responses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    proxyPublicPostMock.mockRejectedValue(
      new ProxyUpstreamError(
        400,
        JSON.stringify({ message: "database password=secret", tokenHash: "hash_123" }),
      ),
    );
    const req = new NextRequest(
      "http://localhost:3005/api/public/onboarding/tok_123/business-profile",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: "Ada Shop",
          industry: "FOREX",
          websiteUrl: "https://ada.example",
        }),
      },
    );

    const res = await POST(req, { params: Promise.resolve({ token: "tok_123" }) });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; upstreamStatus?: number };
    expect(body.message).toBe("Request rejected by upstream service");
    expect(body.upstreamStatus).toBe(400);
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });
});
