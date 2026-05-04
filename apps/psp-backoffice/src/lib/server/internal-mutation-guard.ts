import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const MUTATION_HEADER = "x-backoffice-mutation";

export type InternalMutationGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function singleHostHeader(value: string | null): string | undefined {
  if (!value) return undefined;
  const part = value.split(",")[0]?.trim();
  return part || undefined;
}

/**
 * En cadenas proxy coma-separadas, el último segmento suele ser el valor más cercano al proceso
 * (último proxy antes del Node). Solo se usa cuando {@link trustForwardedOriginHeaders} está activo.
 */
function lastForwardedSegment(value: string | null): string | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}

/**
 * `X-Forwarded-Host` / `X-Forwarded-Proto` son spoofeables si el cliente llega directo al Node sin
 * un borde que las controle. Opt-in explícito (`TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS`) o runtime
 * conocido donde el borde controla esos valores (`VERCEL=1`, `CF_PAGES=1`, `RENDER=true`), en línea con
 * la política de cabeceras de proxy descrita en `client-ip.ts`.
 */
function trustForwardedOriginHeaders(): boolean {
  return (
    process.env.TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS === "true" ||
    process.env.VERCEL === "1" ||
    process.env.CF_PAGES === "1" ||
    process.env.RENDER === "true"
  );
}

/**
 * Origen público del request detrás de proxy TLS (Render, Cloudflare, etc.):
 * `request.nextUrl.origin` puede ser `http://127.0.0.1:puerto` mientras el navegador envía
 * `Origin: https://host-público` (válido). No sustituye la comprobación con `nextUrl.origin`:
 * se acepta si coincide con cualquiera de los dos.
 *
 * Sin {@link trustForwardedOriginHeaders}, devuelve siempre `null` (no se reconstruye desde
 * cabeceras forward).
 *
 * Con confianza: host desde cabecera `Host` (primer valor si viniera coma-separado) o, si falta,
 * último segmento de `X-Forwarded-Host`; protocolo desde el último segmento de `X-Forwarded-Proto`
 * (`http` o `https`).
 */
function derivedPublicOrigin(request: NextRequest): string | null {
  if (!trustForwardedOriginHeaders()) return null;

  const host =
    singleHostHeader(request.headers.get("host")) ??
    lastForwardedSegment(request.headers.get("x-forwarded-host"));
  if (!host) return null;

  const proto = lastForwardedSegment(request.headers.get("x-forwarded-proto"));
  if (proto !== "http" && proto !== "https") return null;
  return `${proto}://${host}`;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === request.nextUrl.origin) return true;
  const derived = derivedPublicOrigin(request);
  return derived !== null && origin === derived;
}

/**
 * Exige cabecera explícita de mutación y `Origin` alineado con el backoffice cuando `Origin` está presente.
 * Además de `request.nextUrl.origin`, puede aceptar coincidencia con origen reconstruido desde `Host`
 * (preferido) + último segmento de `X-Forwarded-Proto`, u opcionalmente `X-Forwarded-Host`, **solo**
 * si hay confianza en cabeceras forward (`TRUST_BACKOFFICE_FORWARDED_ORIGIN_HEADERS=true` o runtime
 * Vercel / Cloudflare Pages / Render donde el borde controla esos valores).
 */
export function enforceInternalMutationRequest(request: NextRequest): InternalMutationGuardResult {
  if (request.headers.get(MUTATION_HEADER) !== "1") {
    return { ok: false, response: NextResponse.json({ message: "Forbidden" }, { status: 403 }) };
  }
  if (!sameOrigin(request)) {
    return { ok: false, response: NextResponse.json({ message: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}
