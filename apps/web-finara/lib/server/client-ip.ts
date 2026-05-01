import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

/** Longitud máxima razonable para una representación textual de IP (IPv6). */
const MAX_IP_STRING_LEN = 45;

/**
 * Normaliza un candidato a IP para rate limiting: trim, longitud, IPv6 entre corchetes,
 * IPv4 con puerto opcional. Devuelve la forma que debe usarse como clave si es válida.
 */
export function normalizeClientIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_IP_STRING_LEN) return null;

  const bracketPort = trimmed.indexOf("]:");
  if (bracketPort !== -1 && trimmed.startsWith("[")) {
    const inner = trimmed.slice(1, bracketPort);
    const portPart = trimmed.slice(bracketPort + 2);
    if (/^\d+$/.test(portPart) && isIP(inner) !== 0) return inner;
  }

  const withoutBrackets =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;

  if (isIP(withoutBrackets) !== 0) return withoutBrackets;

  const colonIdx = withoutBrackets.lastIndexOf(":");
  if (colonIdx !== -1 && !withoutBrackets.includes(":", colonIdx + 1)) {
    const host = withoutBrackets.slice(0, colonIdx);
    const maybePort = withoutBrackets.slice(colonIdx + 1);
    if (/^\d+$/.test(maybePort) && isIP(host) !== 0) return host;
  }

  return null;
}

type NextRequestWithIp = NextRequest & { ip?: string };

/**
 * En Render (`RENDER=true`) el borde controla `X-Forwarded-For` / `X-Real-IP`; equivale a proxy de confianza.
 * Fuera de Render, opt-in explícito vía `TRUST_X_FORWARDED_FOR=true` (misma política que `psp-backoffice`).
 */
function trustProxyForwardedClientHeaders(): boolean {
  return (
    process.env.TRUST_X_FORWARDED_FOR === "true" || process.env.RENDER === "true"
  );
}

function trustPlatformIpHeadersOptIn(): boolean {
  return process.env.TRUST_PLATFORM_IP_HEADERS === "true";
}

function trustVercelForwardedForHeader(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.TRUST_VERCEL_IP_HEADERS === "true" ||
    trustPlatformIpHeadersOptIn()
  );
}

function trustCfConnectingIpHeader(): boolean {
  return (
    process.env.CF_PAGES === "1" ||
    process.env.TRUST_CLOUDFLARE_IP_HEADERS === "true" ||
    trustPlatformIpHeadersOptIn()
  );
}

function firstValidIpFromForwardedList(headerValue: string | null): string | null {
  if (!headerValue) return null;
  for (const segment of headerValue.split(",")) {
    const normalized = normalizeClientIp(segment);
    if (normalized) return normalized;
  }
  return null;
}

export const LOGIN_RATE_LIMIT_UNRESOLVED_KEY = "__psp_bo_login_rl_unresolved__";

export const LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX = "__psp_bo_login_rl_fp:";

const MAX_FINGERPRINT_UA_LEN = 1024;
const MAX_FINGERPRINT_ACCEPT_LANGUAGE_LEN = 256;

function normalizeFingerprintPart(raw: string | null, maxLen: number): string {
  if (!raw) return "";
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen);
}

export function computeLoginRateLimitKeyWithoutClientIp(
  userAgent: string | null,
  acceptLanguage: string | null,
): string {
  const ua = normalizeFingerprintPart(userAgent, MAX_FINGERPRINT_UA_LEN);
  const al = normalizeFingerprintPart(acceptLanguage, MAX_FINGERPRINT_ACCEPT_LANGUAGE_LEN);
  if (!ua && !al) return LOGIN_RATE_LIMIT_UNRESOLVED_KEY;

  const digest = createHash("sha256")
    .update(`ua:${ua}\nal:${al}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `${LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX}${digest}`;
}

function collectIgnoredProxyClientIpHeaderNames(request: NextRequest): string[] {
  const names: string[] = [];
  if (!trustProxyForwardedClientHeaders()) {
    if (request.headers.get("x-forwarded-for")) names.push("x-forwarded-for");
    if (request.headers.get("x-real-ip")) names.push("x-real-ip");
  }
  if (!trustVercelForwardedForHeader() && request.headers.get("x-vercel-forwarded-for")) {
    names.push("x-vercel-forwarded-for");
  }
  if (!trustCfConnectingIpHeader() && request.headers.get("cf-connecting-ip")) {
    names.push("cf-connecting-ip");
  }
  return [...new Set(names)];
}

const LOGIN_RL_IGNORED_PROXY_HEADERS_LOG_COOLDOWN_MS = 60_000;
let lastLoginRlIgnoredProxyHeadersLogAt = 0;

function logIgnoredProxyClientIpHeaders(headerNames: string[]): void {
  if (headerNames.length === 0) return;
  const now = Date.now();
  if (now - lastLoginRlIgnoredProxyHeadersLogAt < LOGIN_RL_IGNORED_PROXY_HEADERS_LOG_COOLDOWN_MS) {
    return;
  }
  lastLoginRlIgnoredProxyHeadersLogAt = now;
  const sorted = [...headerNames].sort();
  console.warn(
    `[web-finara] merchant onboarding proxy: client IP unresolved; ignoring incoming proxy/platform IP headers (${sorted.join(", ")}) because trust flags are off. On Render set RENDER (default) or TRUST_X_FORWARDED_FOR=true; on Vercel/Cloudflare use their runtime or TRUST_PLATFORM_IP_HEADERS / TRUST_VERCEL_IP_HEADERS / TRUST_CLOUDFLARE_IP_HEADERS.`,
  );
}

const LOGIN_RL_SENTINEL_LOG_COOLDOWN_MS = 60_000;
let lastLoginRlSentinelLogAt = 0;

function logLoginRateLimitSentinelNoFingerprint(): void {
  const now = Date.now();
  if (now - lastLoginRlSentinelLogAt < LOGIN_RL_SENTINEL_LOG_COOLDOWN_MS) return;
  lastLoginRlSentinelLogAt = now;
  console.warn(
    "[web-finara] merchant onboarding proxy: client IP unresolved and no User-Agent/Accept-Language; using global unresolved bucket (RENDER=true or TRUST_X_FORWARDED_FOR=true behind a trusted proxy; or TRUST_PLATFORM_IP_HEADERS / deploy on Vercel/CF Pages)",
  );
}

/**
 * Resuelve la IP del cliente (misma política que `psp-backoffice` + auto-confianza en Render).
 */
export function resolveLoginRateLimitClientIp(request: NextRequest): string | null {
  const req = request as NextRequestWithIp;
  if (typeof req.ip === "string") {
    const n = normalizeClientIp(req.ip);
    if (n) return n;
  }

  if (trustVercelForwardedForHeader()) {
    const fromVercel = firstValidIpFromForwardedList(
      request.headers.get("x-vercel-forwarded-for"),
    );
    if (fromVercel) return fromVercel;
  }

  const trusted = trustProxyForwardedClientHeaders();
  if (trusted) {
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      const n = normalizeClientIp(realIp);
      if (n) return n;
    }
  }

  if (trustCfConnectingIpHeader()) {
    const cfIp = request.headers.get("cf-connecting-ip");
    if (cfIp) {
      const n = normalizeClientIp(cfIp);
      if (n) return n;
    }
  }

  if (trusted) {
    return firstValidIpFromForwardedList(request.headers.get("x-forwarded-for"));
  }

  logIgnoredProxyClientIpHeaders(collectIgnoredProxyClientIpHeaderNames(request));
  return null;
}

export function resolveLoginRateLimitKey(request: NextRequest): string[] {
  const ip = resolveLoginRateLimitClientIp(request);
  if (ip) return [ip];

  const key = computeLoginRateLimitKeyWithoutClientIp(
    request.headers.get("user-agent"),
    request.headers.get("accept-language"),
  );
  if (key === LOGIN_RATE_LIMIT_UNRESOLVED_KEY) {
    logLoginRateLimitSentinelNoFingerprint();
    return [LOGIN_RATE_LIMIT_UNRESOLVED_KEY];
  }

  return [key, LOGIN_RATE_LIMIT_UNRESOLVED_KEY];
}
