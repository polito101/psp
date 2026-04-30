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

  // "[IPv6]:port" (p. ej. proxies)
  const bracketPort = trimmed.indexOf("]:");
  if (bracketPort !== -1 && trimmed.startsWith("[")) {
    const inner = trimmed.slice(1, bracketPort);
    const portPart = trimmed.slice(bracketPort + 2);
    if (/^\d+$/.test(portPart) && isIP(inner) !== 0) return inner;
  }

  const withoutBrackets =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;

  if (isIP(withoutBrackets) !== 0) return withoutBrackets;

  // IPv4 con puerto (`203.0.113.1:8080`): usar solo el host si es IPv4 válida.
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
 * Indica que el despliegue está detrás de un **proxy de confianza** que controla
 * `X-Forwarded-For` y `X-Real-IP` (las sobrescribe o las añade en el borde).
 * Sin eso, un cliente puede falsificar esas cabeceras y desviar el rate limit a otra IP (DoS dirigido).
 *
 * Por defecto (`false` / ausente) **no** se leen; solo se usan `request.ip` y cabeceras típicas
 * de plataforma (`x-vercel-forwarded-for`, `cf-connecting-ip`).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
 */
function trustProxyForwardedClientHeaders(): boolean {
  return process.env.TRUST_X_FORWARDED_FOR === "true";
}

/**
 * Recorre segmentos separados por comas (orden típico cliente → proxies) y devuelve
 * la primera IP normalizable. Evita descartar cabeceras cuando solo el primer hop es inválido.
 */
function firstValidIpFromForwardedList(headerValue: string | null): string | null {
  if (!headerValue) return null;
  for (const segment of headerValue.split(",")) {
    const normalized = normalizeClientIp(segment);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * Clave de rate limit cuando no hay IP ni cabeceras `User-Agent` / `Accept-Language`
 * utilizables para un fingerprint. Agrupa esos intentos (último recurso); evita bypass del
 * límite. No sustituye WAF/edge; en multi-instancia el bucket es local al proceso.
 */
export const LOGIN_RATE_LIMIT_UNRESOLVED_KEY = "__psp_bo_login_rl_unresolved__";

/** Prefijo de claves derivadas sin IP pero con fingerprint estable (UA + idioma). */
export const LOGIN_RATE_LIMIT_UNRESOLVED_FINGERPRINT_PREFIX = "__psp_bo_login_rl_fp:";

const MAX_FINGERPRINT_UA_LEN = 1024;
const MAX_FINGERPRINT_ACCEPT_LANGUAGE_LEN = 256;

/**
 * Normaliza un fragmento para el fingerprint (trim, espacios colapsados, longitud acotada).
 */
function normalizeFingerprintPart(raw: string | null, maxLen: number): string {
  if (!raw) return "";
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen);
}

/**
 * Construye la clave de RL cuando no hay IP: hash estable de User-Agent + Accept-Language,
 * o {@link LOGIN_RATE_LIMIT_UNRESOLVED_KEY} si ambas cabeceras faltan o quedan vacías.
 */
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

/**
 * Resuelve la IP del cliente para rate limit best-effort.
 *
 * Orden: `request.ip`; primer IP válida en **toda** la lista de `x-vercel-forwarded-for`;
 * si `TRUST_X_FORWARDED_FOR=true`: `x-real-ip` y `x-forwarded-for` (listas con varios hops);
 * `cf-connecting-ip` (Cloudflare).
 *
 * `X-Forwarded-For` / `X-Real-IP` sin proxy de confianza son spoofeables; quedan desactivados
 * salvo opt-in explícito con `TRUST_X_FORWARDED_FOR=true`.
 *
 * Si no hay ninguna IP válida, devuelve `null` (usar `resolveLoginRateLimitKey` para no saltar el RL).
 */
export function resolveLoginRateLimitClientIp(request: NextRequest): string | null {
  const req = request as NextRequestWithIp;
  if (typeof req.ip === "string") {
    const n = normalizeClientIp(req.ip);
    if (n) return n;
  }

  const fromVercel = firstValidIpFromForwardedList(
    request.headers.get("x-vercel-forwarded-for"),
  );
  if (fromVercel) return fromVercel;

  const trusted = trustProxyForwardedClientHeaders();
  if (trusted) {
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      const n = normalizeClientIp(realIp);
      if (n) return n;
    }
  }

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) {
    const n = normalizeClientIp(cfIp);
    if (n) return n;
  }

  if (trusted) {
    return firstValidIpFromForwardedList(request.headers.get("x-forwarded-for"));
  }

  return null;
}

/**
 * Clave estable para `checkLoginRateLimit`: IP normalizada; si no hay IP, fingerprint por
 * `User-Agent` + `Accept-Language`; si tampoco hay datos, `LOGIN_RATE_LIMIT_UNRESOLVED_KEY`.
 * Siempre aplica throttling en `POST /api/auth/session`.
 */
export function resolveLoginRateLimitKey(request: NextRequest): string {
  const ip = resolveLoginRateLimitClientIp(request);
  if (ip) return ip;

  const key = computeLoginRateLimitKeyWithoutClientIp(
    request.headers.get("user-agent"),
    request.headers.get("accept-language"),
  );
  if (key === LOGIN_RATE_LIMIT_UNRESOLVED_KEY) {
    logLoginRateLimitSentinelNoFingerprint();
  }
  return key;
}

/** Evita spam en logs bajo tráfico repetido; una línea ~por minuto por proceso. */
const LOGIN_RL_SENTINEL_LOG_COOLDOWN_MS = 60_000;
let lastLoginRlSentinelLogAt = 0;

function logLoginRateLimitSentinelNoFingerprint(): void {
  const now = Date.now();
  if (now - lastLoginRlSentinelLogAt < LOGIN_RL_SENTINEL_LOG_COOLDOWN_MS) return;
  lastLoginRlSentinelLogAt = now;
  console.warn(
    "[psp-backoffice] login rate limit: client IP unresolved and no User-Agent/Accept-Language; using global unresolved bucket (set TRUST_X_FORWARDED_FOR=true only if a trusted proxy overwrites X-Forwarded-For / X-Real-IP)",
  );
}
