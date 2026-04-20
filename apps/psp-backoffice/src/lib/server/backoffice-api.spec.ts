import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mapProxyError,
  ProxyUpstreamError,
  readResponseTextWithByteLimit,
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
