import { describe, it, expect } from "vitest";
import { tryDecodeRoutePathSegment } from "./decode-route-path-segment";

describe("tryDecodeRoutePathSegment", () => {
  it("decodes percent-encoded segments", () => {
    expect(tryDecodeRoutePathSegment("ab%20cd")).toEqual({ ok: true, value: "ab cd" });
  });

  it("returns ok for segments without escapes", () => {
    expect(tryDecodeRoutePathSegment("plain-token")).toEqual({ ok: true, value: "plain-token" });
  });

  it("returns ok false on invalid percent-encoding (would throw URIError)", () => {
    expect(tryDecodeRoutePathSegment("%")).toEqual({ ok: false });
    expect(tryDecodeRoutePathSegment("%ZZ")).toEqual({ ok: false });
  });
});
