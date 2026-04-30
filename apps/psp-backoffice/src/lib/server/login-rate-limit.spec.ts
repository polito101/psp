import { describe, expect, it, beforeEach } from "vitest";
import { LOGIN_RATE_LIMIT_UNRESOLVED_KEY, LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX } from "./client-ip";
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
    expect(checkLoginRateLimit(["127.0.0.1"]).allowed).toBe(true);
  });

  it("blocks after repeated attempts", () => {
    let last = checkLoginRateLimit(["127.0.0.1"]);
    for (let i = 0; i < 10; i += 1) last = checkLoginRateLimit(["127.0.0.1"]);
    expect(last.allowed).toBe(false);
    if (!last.allowed) expect(last.retryAfterSec).toBeGreaterThan(0);
  });

  it("removes expired buckets on sweep (time-based window)", () => {
    setLoginRateLimitTestOptions({ sweepIntervalMs: 0 });
    const t0 = 1_000_000;
    checkLoginRateLimit(["a"], t0);
    expect(getLoginRateLimitBucketCountForTests()).toBe(1);
    checkLoginRateLimit(["b"], t0 + 60_001);
    expect(getLoginRateLimitBucketCountForTests()).toBe(1);
  });

  it("sweepLoginRateLimitBucketsForTests drops only expired entries", () => {
    const t0 = 2_000_000;
    checkLoginRateLimit(["x"], t0);
    const removed = sweepLoginRateLimitBucketsForTests(t0 + 60_001);
    expect(removed).toBe(1);
    expect(getLoginRateLimitBucketCountForTests()).toBe(0);
  });

  it("evicts oldest entries when max bucket count is exceeded", () => {
    setLoginRateLimitTestOptions({ maxBuckets: 3, sweepIntervalMs: 0 });
    checkLoginRateLimit(["k1"]);
    checkLoginRateLimit(["k2"]);
    checkLoginRateLimit(["k3"]);
    expect(getLoginRateLimitBucketCountForTests()).toBe(3);
    checkLoginRateLimit(["k4"]);
    expect(getLoginRateLimitBucketCountForTests()).toBe(3);
    expect(checkLoginRateLimit(["k1"]).allowed).toBe(true);
    expect(getLoginRateLimitBucketCountForTests()).toBe(3);
  });

  it("deduplica claves repetidas en un mismo intento (un solo incremento por clave)", () => {
    checkLoginRateLimit(["same", "same", "same"]);
    expect(getLoginRateLimitBucketCountForTests()).toBe(1);
  });

  it("con fingerprint + bucket global unresolved, rotar UA no suma capacidad más allá del límite global", () => {
    const global = LOGIN_RATE_LIMIT_UNRESOLVED_KEY;
    for (let i = 0; i < 10; i += 1) {
      const fp = `${LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX}rot${i}`;
      expect(checkLoginRateLimit([fp, global]).allowed).toBe(true);
    }
    const newFp = `${LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX}rot_new_ua`;
    expect(checkLoginRateLimit([newFp, global]).allowed).toBe(false);
  });

  it("si cualquier clave superaría el límite, deniega sin mutar buckets", () => {
    const global = LOGIN_RATE_LIMIT_UNRESOLVED_KEY;
    for (let i = 0; i < 10; i += 1) {
      expect(checkLoginRateLimit([`fp:${i}`, global]).allowed).toBe(true);
    }
    expect(checkLoginRateLimit(["fp:bonus", global]).allowed).toBe(false);
    expect(checkLoginRateLimit(["fp:bonus", global]).allowed).toBe(false);
    expect(checkLoginRateLimit(["fp:0", global]).allowed).toBe(false);
  });
});
