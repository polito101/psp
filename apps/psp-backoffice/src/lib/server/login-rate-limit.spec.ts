import { describe, expect, it, beforeEach } from "vitest";
import { checkLoginRateLimit, resetLoginRateLimitForTests } from "./login-rate-limit";

describe("checkLoginRateLimit", () => {
  beforeEach(() => resetLoginRateLimitForTests());

  it("allows initial attempts", () => {
    expect(checkLoginRateLimit("127.0.0.1").allowed).toBe(true);
  });

  it("blocks after repeated attempts", () => {
    let last = checkLoginRateLimit("127.0.0.1");
    for (let i = 0; i < 10; i += 1) last = checkLoginRateLimit("127.0.0.1");
    expect(last.allowed).toBe(false);
    if (!last.allowed) expect(last.retryAfterSec).toBeGreaterThan(0);
  });
});
