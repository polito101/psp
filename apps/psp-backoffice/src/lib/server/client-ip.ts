import type { NextRequest } from "next/server";
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
 * Clave de rate limit cuando no hay IP cliente normalizable. Agrupa intentos sin IP
 * resoluble (no es una IP real); evita bypass del límite por cabeceras inválidas o vacías.
 * No sustituye WAF/edge; en multi-instancia el bucket es local al proceso.
 */
export const LOGIN_RATE_LIMIT_UNRESOLVED_KEY = "__psp_bo_login_rl_unresolved__";

/**
 * Resuelve la IP del cliente para rate limit best-effort.
 * Prioriza valores típicamente establecidos por el runtime/plataforma; en `X-Forwarded-For` y
 * `X-Vercel-Forwarded-For` se consideran **todos** los hops, no solo el primero.
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

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const n = normalizeClientIp(realIp);
    if (n) return n;
  }

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) {
    const n = normalizeClientIp(cfIp);
    if (n) return n;
  }

  return firstValidIpFromForwardedList(request.headers.get("x-forwarded-for"));
}

/**
 * Clave estable para `checkLoginRateLimit`: IP normalizada o `LOGIN_RATE_LIMIT_UNRESOLVED_KEY`
 * si no se pudo resolver ninguna (siempre aplica throttling en `POST /api/auth/session`).
 */
export function resolveLoginRateLimitKey(request: NextRequest): string {
  return resolveLoginRateLimitClientIp(request) ?? LOGIN_RATE_LIMIT_UNRESOLVED_KEY;
}
