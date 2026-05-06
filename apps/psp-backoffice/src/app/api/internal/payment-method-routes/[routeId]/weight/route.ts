import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PaymentMethodRouteRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPatch } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ routeId: string }> };

const bodySchema = z.object({
  weight: z.coerce.number().int(),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  const mutation = enforceInternalMutationRequest(request);
  if (!mutation.ok) {
    return mutation.response;
  }
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const adminOnly = requireAdminClaims(auth.claims);
  if (adminOnly) {
    return adminOnly;
  }
  const { routeId: rawId } = await context.params;
  let routeId: string;
  try {
    routeId = decodeURIComponent(rawId);
  } catch {
    return NextResponse.json({ message: "Invalid routeId" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const encoded = encodeURIComponent(routeId);
    const data = await proxyInternalPatch<PaymentMethodRouteRow>({
      path: `/api/v2/payments/ops/configuration/routes/${encoded}/weight`,
      body: parsed.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
