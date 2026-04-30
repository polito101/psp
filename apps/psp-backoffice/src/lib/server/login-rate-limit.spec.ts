import { describe, expect, it, beforeEach } from "vitest";
import {
  checkLoginRateLimit,
  getLoginRateLimitBucketCountForTests,
  resetLoginRateLimitForTests,
  setLoginRateLimitTestOptions,
  sweepLoginRateLimitBucketsForTests,
} from "./login-rate-limit";

describe("checkLoginRateLimit", () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
  });

  it("allows initial attempts", () => {
    expect(checkLoginRateLimit("127.0.0.1").allowed).toBe(true);
  });

  it("blocks after repeated attempts", () => {
    let last = checkLoginRateLimit("127.0.0.1");
    for (let i = 0; i < 10; i += 1) last = checkLoginRateLimit("127.0.0.1");
    expect(last.allowed).toBe(false);
    if (!last.allowed) expect(last.retryAfterSec).toBeGreaterThan(0);
  });

  it("removes expired buckets on sweep (time-based window)", () => {
    setLoginRateLimitTestOptions({ sweepIntervalMs: 0 });
    const t0 = 1_000_000;
    checkLoginRateLimit("a", t0);
    expect(getLoginRateLimitBucketCountForTests()).toBe(1);
    checkLoginRateLimit("b", t0 + 60_001);
    expect(getLoginRateLimitBucketCountForTests()).toBe(1);
  });

  it("sweepLoginRateLimitBucketsForTests drops only expired entries", () => {
    const t0 = 2_000_000;
    checkLoginRateLimit("x", t0);
    const removed = sweepLoginRateLimitBucketsForTests(t0 + 60_001);
    expect(removed).toBe(1);
    expect(getLoginRateLimitBucketCountForTests()).toBe(0);
  });

  it("evicts oldest entries when max bucket count is exceeded", () => {
    setLoginRateLimitTestOptions({ maxBuckets: 3, sweepIntervalMs: 0 });
    checkLoginRateLimit("k1");
    checkLoginRateLimit("k2");
    checkLoginRateLimit("k3");
    expect(getLoginRateLimitBucketCountForTests()).toBe(3);
    checkLoginRateLimit("k4");
    expect(getLoginRateLimitBucketCountForTests()).toBe(3);
    expect(checkLoginRateLimit("k1").allowed).toBe(true);
    expect(getLoginRateLimitBucketCountForTests()).toBe(3);
  });
});
