import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  isPaymentsV2OpsPath,
  mapProxyError,
  proxyInternalGet,
  proxyPublicGet,
  proxyPublicPost,
  ProxyUpstreamError,
  readResponseTextWithByteLimit,
  requiresBackofficeScopePath,
} from "./backoffice-api";

const MAX_BYTES = 64 * 1024;

describe("mapProxyError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs null bodyByteLength when upstream body was not measured safely", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    mapProxyError(new ProxyUpstreamError(502, "", true, null));
    expect(spy).toHaveBeenCalledWith(
      "backoffice_proxy_error",
      expect.objectContaining({
        bodyByteLength: null,
        bodyTruncatedByReader: true,
      }),
    );
  });

  it("for upstream 5xx returns generic 502 and does not echo raw body", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError(new ProxyUpstreamError(500, "database password=secret"));
    expect(res.status).toBe(502);

    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Upstream service unavailable");
    expect(JSON.stringify(body)).not.toContain("password");
    expect(spy).toHaveBeenCalledWith(
      "backoffice_proxy_error",
      expect.objectContaining({
        kind: "ProxyUpstreamError",
        upstreamStatus: 500,
        bodyByteLength: expect.any(Number),
        bodyTruncatedByReader: false,
      }),
    );
    const payload = spy.mock.calls[0]?.[1] as { bodyPreview?: string };
    expect(payload.bodyPreview?.length).toBeLessThanOrEqual(200);
  });

  it("for upstream 400 with JSON body returns safe message and does not echo upstream payload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError(
      new ProxyUpstreamError(
        400,
        JSON.stringify({ message: "database password=secret", statusCode: 400, details: { raw: true } }),
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; upstreamStatus?: number };
    expect(body.message).toBe("Request rejected by upstream service");
    expect(body.upstreamStatus).toBe(400);
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("details");
  });

  it("for upstream 404 with non-JSON body returns safe not-found message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError(new ProxyUpstreamError(404, "internal merchant id mrc_secret"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string; upstreamStatus?: number };
    expect(body.message).toBe("Resource not found");
    expect(body.upstreamStatus).toBe(404);
    expect(JSON.stringify(body)).not.toContain("mrc_secret");
  });

  it("maps AbortError to 504 timeout", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new Error("aborted");
    err.name = "AbortError";
    const res = mapProxyError(err);
    expect(res.status).toBe(504);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Upstream request timed out");
  });

  it("handles non-Error values", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError("boom");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Upstream service unavailable");
  });
});

describe("readResponseTextWithByteLimit", () => {
  it("without body reader and no Content-Length, does not call response.text() and returns unknown byte length", async () => {
    const textSpy = vi.spyOn(Response.prototype, "text");

    const res = new Response(null);
    const out = await readResponseTextWithByteLimit(res, MAX_BYTES);

    expect(textSpy).not.toHaveBeenCalled();
    expect(out).toEqual({ text: "", truncated: true, measuredBodyBytes: null });
  });

  it("without body reader and Content-Length above max, skips reading body", async () => {
    const textSpy = vi.spyOn(Response.prototype, "text");

    const res = new Response(null, {
      headers: { "content-length": String(MAX_BYTES + 1) },
    });
    const out = await readResponseTextWithByteLimit(res, MAX_BYTES);

    expect(textSpy).not.toHaveBeenCalled();
    expect(out.measuredBodyBytes).toBeNull();
    expect(out.truncated).toBe(true);
  });

  it("without body reader and small Content-Length, reads bounded body via text()", async () => {
    const res = new Response(null, {
      headers: { "content-length": "0" },
    });
    const out = await readResponseTextWithByteLimit(res, MAX_BYTES);

    expect(out).toEqual({ text: "", truncated: false, measuredBodyBytes: 0 });
  });
});

describe("proxyInternalGet RBAC", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...envSnapshot };
    process.env.PSP_API_BASE_URL = "http://localhost:3003";
    process.env.PSP_INTERNAL_API_SECRET = "intsecret";
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  it("rejects ops path without backofficeScope before fetch", async () => {
    await expect(proxyInternalGet({ path: "/api/v2/payments/ops/metrics" })).rejects.toThrow(/backofficeScope/);
  });

  it("rejects settlements path without backofficeScope before fetch", async () => {
    await expect(proxyInternalGet({ path: "/api/v1/settlements/requests/inbox" })).rejects.toThrow(/backofficeScope/);
  });

  it("sends X-Backoffice-Role for admin on ops path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await proxyInternalGet<{ ok: boolean }>({
      path: "/api/v2/payments/ops/metrics",
      backofficeScope: { sub: "a", role: "admin" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const h = new Headers(init.headers as HeadersInit);
    expect(h.get("X-Backoffice-Role")).toBe("admin");
    expect(h.get("X-Internal-Secret")).toBe("intsecret");
  });

  it("sends merchant headers for merchant scope", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await proxyInternalGet<{ items: unknown[] }>({
      path: "/api/v2/payments/ops/transactions",
      searchParams: new URLSearchParams({ merchantId: "m1" }),
      backofficeScope: { sub: "m", role: "merchant", merchantId: "m1" },
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const h = new Headers(init.headers as HeadersInit);
    expect(h.get("X-Backoffice-Role")).toBe("merchant");
    expect(h.get("X-Backoffice-Merchant-Id")).toBe("m1");
  });
});

describe("public proxy helpers", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...envSnapshot };
    process.env.PSP_API_BASE_URL = "http://localhost:3003";
    process.env.PSP_INTERNAL_API_SECRET = "intsecret";
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  it("proxyPublicGet uses manual redirects and does not send the internal secret", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await proxyPublicGet<{ ok: boolean }>({
      path: "/api/v1/merchant-onboarding/tokens/tok_123",
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const h = new Headers(init.headers as HeadersInit | undefined);
    expect(init.redirect).toBe("manual");
    expect(h.get("X-Internal-Secret")).toBeNull();
  });

  it("proxyPublicPost uses manual redirects and does not send the internal secret", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "app_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await proxyPublicPost<{ id: string }>({
      path: "/api/v1/merchant-onboarding/tokens/tok_123/business-profile",
      body: { tradeName: "Ada Shop" },
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const h = new Headers(init.headers as HeadersInit);
    expect(init.redirect).toBe("manual");
    expect(h.get("X-Internal-Secret")).toBeNull();
    expect(h.get("Content-Type")).toBe("application/json");
  });

  it("maps public proxy redirects to a safe browser response without leaking Location", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/secret-token" },
      }),
    );

    let captured: unknown;
    try {
      await proxyPublicGet({ path: "/api/v1/merchant-onboarding/tokens/tok_123" });
    } catch (error) {
      captured = error;
    }

    const res = mapProxyError(captured);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Upstream service unavailable");
    expect(JSON.stringify(body)).not.toContain("evil.example");
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });

  it("maps public proxy upstream errors without echoing raw dangerous bodies", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "database password=secret", tokenHash: "hash_123" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    let captured: unknown;
    try {
      await proxyPublicPost({
        path: "/api/v1/merchant-onboarding/tokens/tok_123/business-profile",
        body: { tradeName: "Ada Shop" },
      });
    } catch (error) {
      captured = error;
    }

    const res = mapProxyError(captured);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; upstreamStatus?: number };
    expect(body.message).toBe("Request rejected by upstream service");
    expect(body.upstreamStatus).toBe(400);
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });
});

describe("isPaymentsV2OpsPath", () => {
  it("returns true for metrics path", () => {
    expect(isPaymentsV2OpsPath("/api/v2/payments/ops/metrics")).toBe(true);
  });
});

describe("requiresBackofficeScopePath", () => {
  it("includes merchants ops and settlements", () => {
    expect(requiresBackofficeScopePath("/api/v1/merchants/ops/directory")).toBe(true);
    expect(requiresBackofficeScopePath("/api/v1/merchant-onboarding/ops/applications")).toBe(true);
    expect(requiresBackofficeScopePath("/api/v1/settlements/merchants/x/requests")).toBe(true);
    expect(requiresBackofficeScopePath("/api/v2/payments/ops/transactions")).toBe(true);
    expect(requiresBackofficeScopePath("/api/v1/merchants")).toBe(false);
  });
});
