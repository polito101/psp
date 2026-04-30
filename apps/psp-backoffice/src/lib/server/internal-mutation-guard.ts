import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const MUTATION_HEADER = "x-backoffice-mutation";

export type InternalMutationGuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === request.nextUrl.origin;
}

/**
 * Exige cabecera explícita de mutación y mismo `Origin` que el host del BFF cuando `Origin` está presente.
 * Mitiga CSRF sobre cookies same-site en escenarios edge.
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
