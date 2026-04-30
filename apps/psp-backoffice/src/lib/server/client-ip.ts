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
 * Resuelve la IP del cliente para rate limit best-effort.
 * Prioriza valores típicamente establecidos por el runtime/plataforma sobre `X-Forwarded-For`.
 * Si no hay ninguna IP válida, devuelve `null` (no usar una clave global compartida).
 */
export function resolveLoginRateLimitClientIp(request: NextRequest): string | null {
  const req = request as NextRequestWithIp;
  const candidates: string[] = [];

  if (typeof req.ip === "string") candidates.push(req.ip);

  const vercelIp = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercelIp) candidates.push(vercelIp);

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) candidates.push(realIp);

  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) candidates.push(xff);

  for (const c of candidates) {
    const normalized = normalizeClientIp(c);
    if (normalized) return normalized;
  }

  return null;
}
