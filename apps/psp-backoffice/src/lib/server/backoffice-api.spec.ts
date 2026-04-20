import { describe, it, expect, vi, afterEach } from "vitest";
import { mapProxyError, ProxyUpstreamError } from "./backoffice-api";

describe("mapProxyError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("for upstream 400 with JSON body forwards status and payload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError(
      new ProxyUpstreamError(400, JSON.stringify({ message: "bad", statusCode: 400 })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string; statusCode: number };
    expect(body.message).toBe("bad");
    expect(body.statusCode).toBe(400);
  });

  it("for upstream 400 with non-JSON body returns trimmed text as message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError(new ProxyUpstreamError(404, "not found"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("not found");
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
