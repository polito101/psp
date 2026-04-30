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
 * Por defecto (`false` / ausente) **no** se leen; solo `request.ip` y cabeceras de plataforma
 * si hay señal verificable en el proceso o `TRUST_PLATFORM_IP_HEADERS` / flags granulares
 * (`TRUST_VERCEL_IP_HEADERS`, `TRUST_CLOUDFLARE_IP_HEADERS`).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For
 */
function trustProxyForwardedClientHeaders(): boolean {
  return process.env.TRUST_X_FORWARDED_FOR === "true";
}

/** Opt-in global: confía en IPs de cabeceras típicas de Vercel y Cloudflare. */
function trustPlatformIpHeadersOptIn(): boolean {
  return process.env.TRUST_PLATFORM_IP_HEADERS === "true";
}

/**
 * ¿Puede usarse `x-vercel-forwarded-for` para la clave de RL?
 * En Vercel el runtime expone `VERCEL=1` (no lo fija el cliente HTTP). Fuera de Vercel esa
 * cabecera es spoofeable salvo `TRUST_VERCEL_IP_HEADERS` o `TRUST_PLATFORM_IP_HEADERS`.
 */
function trustVercelForwardedForHeader(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.TRUST_VERCEL_IP_HEADERS === "true" ||
    trustPlatformIpHeadersOptIn()
  );
}

/**
 * ¿Puede usarse `cf-connecting-ip` para la clave de RL?
 * En Cloudflare Pages el runtime suele exponer `CF_PAGES=1`. Tras proxy orange-cloud el origen
 * real suele llegar solo vía CF; fuera de ese entorno la cabecera es spoofeable salvo opt-in.
 */
function trustCfConnectingIpHeader(): boolean {
  return (
    process.env.CF_PAGES === "1" ||
    process.env.TRUST_CLOUDFLARE_IP_HEADERS === "true" ||
    trustPlatformIpHeadersOptIn()
  );
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
 * Nombres de cabeceras de IP de cliente presentes en la petición pero **no** utilizadas por la
 * política de confianza actual (solo nombres; no valores, para evitar filtrar IPs en logs).
 */
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

/** Evita spam en logs bajo tráfico repetido; una línea ~por minuto por proceso. */
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
    `[psp-backoffice] login rate limit: client IP unresolved; ignoring incoming proxy/platform IP headers (${sorted.join(", ")}) because trust flags are off. Behind a trusted reverse proxy, set TRUST_X_FORWARDED_FOR=true for X-Forwarded-For/X-Real-IP; on Vercel/Cloudflare use their runtime or TRUST_PLATFORM_IP_HEADERS / TRUST_VERCEL_IP_HEADERS / TRUST_CLOUDFLARE_IP_HEADERS.`,
  );
}

/** Evita spam en logs bajo tráfico repetido; una línea ~por minuto por proceso. */
const LOGIN_RL_SENTINEL_LOG_COOLDOWN_MS = 60_000;
let lastLoginRlSentinelLogAt = 0;

function logLoginRateLimitSentinelNoFingerprint(): void {
  const now = Date.now();
  if (now - lastLoginRlSentinelLogAt < LOGIN_RL_SENTINEL_LOG_COOLDOWN_MS) return;
  lastLoginRlSentinelLogAt = now;
  console.warn(
    "[psp-backoffice] login rate limit: client IP unresolved and no User-Agent/Accept-Language; using global unresolved bucket (TRUST_X_FORWARDED_FOR=true only behind a trusted proxy for XFF/X-Real-IP; TRUST_PLATFORM_IP_HEADERS / TRUST_VERCEL_IP_HEADERS / TRUST_CLOUDFLARE_IP_HEADERS or deploy on Vercel/CF Pages for platform client-IP headers)",
  );
}

/**
 * Resuelve la IP del cliente para rate limit best-effort.
 *
 * Orden: `request.ip`; si hay confianza en cabeceras Vercel (runtime `VERCEL=1` o
 * `TRUST_VERCEL_IP_HEADERS` / `TRUST_PLATFORM_IP_HEADERS`): primer IP válida en **toda** la lista
 * de `x-vercel-forwarded-for`; si `TRUST_X_FORWARDED_FOR=true`: `x-real-ip` y `x-forwarded-for`;
 * si hay confianza en CF (`CF_PAGES=1` o `TRUST_CLOUDFLARE_IP_HEADERS` / `TRUST_PLATFORM_IP_HEADERS`):
 * `cf-connecting-ip`.
 *
 * `X-Forwarded-For`, `X-Real-IP`, `x-vercel-forwarded-for` y `cf-connecting-ip` son spoofeables
 * si el cliente llega directo al Node sin el borde que las controla; las de plataforma quedan
 * acotadas a señales de runtime u opt-in explícito (igual que XFF con `TRUST_X_FORWARDED_FOR`).
 *
 * Si no hay ninguna IP válida, devuelve `null` (usar `resolveLoginRateLimitKey` para no saltar el RL).
 * Si en esa situación la petición trae `x-forwarded-for` / `x-real-ip` o cabeceras de plataforma
 * no confiables, se emite un `console.warn` throttled (~1 min) con **solo nombres** de cabecera
 * (no valores), para detectar despliegue detrás de proxy sin `TRUST_*` configurado.
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

/**
 * Claves para `checkLoginRateLimit`: IP normalizada; sin IP, fingerprint por `User-Agent` +
 * `Accept-Language` **y** además {@link LOGIN_RATE_LIMIT_UNRESOLVED_KEY} (mismo límite global para
 * todo tráfico sin IP con fingerprint), para que rotar cabeceras no sume capacidad arbitraria.
 * Sin IP ni cabeceras utilizables: solo la clave sentinela.
 */
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
