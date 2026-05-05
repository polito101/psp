import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PaymentProviderConfigRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPatch } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ providerId: string }> };

const patchBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(512).nullable().optional(),
    integrationBaseUrl: z.string().trim().min(1).max(2048).optional(),
    initPaymentResource: z.string().trim().min(1).max(2048).optional(),
    isConfigured: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isPublished: z.boolean().optional(),
  })
  .strict();

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
  const { providerId: rawId } = await context.params;
  let providerId: string;
  try {
    providerId = decodeURIComponent(rawId);
  } catch {
    return NextResponse.json({ message: "Invalid providerId" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }
  const parsed = patchBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ message: "Body must include at least one field" }, { status: 400 });
  }
  try {
    const encoded = encodeURIComponent(providerId);
    const data = await proxyInternalPatch<PaymentProviderConfigRow>({
      path: `/api/v2/payments/ops/configuration/providers/${encoded}`,
      body: parsed.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
