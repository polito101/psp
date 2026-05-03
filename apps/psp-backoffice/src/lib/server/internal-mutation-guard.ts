import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const MUTATION_HEADER = "x-backoffice-mutation";

export type InternalMutationGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function firstForwardedSegment(value: string | null): string | undefined {
  if (!value) return undefined;
  const part = value.split(",")[0]?.trim();
  return part || undefined;
}

/**
 * Origen público del request detrás de proxy TLS (Render, Cloudflare, etc.):
 * `request.nextUrl.origin` puede ser `http://127.0.0.1:puerto` mientras el navegador envía
 * `Origin: https://host-público` (válido). No sustituye la comprobación con `nextUrl.origin`:
 * se acepta si coincide con cualquiera de los dos.
 */
function derivedPublicOrigin(request: NextRequest): string | null {
  const host =
    firstForwardedSegment(request.headers.get("x-forwarded-host")) ??
    firstForwardedSegment(request.headers.get("host"));
  if (!host) return null;
  const proto = firstForwardedSegment(request.headers.get("x-forwarded-proto"));
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
 * Además de `request.nextUrl.origin`, acepta coincidencia con `Host` + `X-Forwarded-Proto` (y opcionalmente
 * `X-Forwarded-Host`) para despliegues detrás de TLS terminado en el edge.
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
