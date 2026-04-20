import { describe, it, expect, vi, afterEach } from "vitest";
import { mapProxyError } from "./backoffice-api";

describe("mapProxyError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a generic message and does not echo upstream details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError(new Error("PSP API 500: raw secret details"));
    expect(res.status).toBe(502);

    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Upstream service unavailable");
    expect(body.message).not.toContain("raw secret");
    expect(spy).toHaveBeenCalled();
  });

  it("handles non-Error values", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = mapProxyError("boom");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Upstream service unavailable");
  });
});
