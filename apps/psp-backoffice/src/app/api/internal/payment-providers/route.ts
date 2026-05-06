import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PaymentProviderConfigRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet, proxyInternalPost } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(512).optional(),
  integrationBaseUrl: z.string().trim().min(1).max(2048),
  initPaymentResource: z.string().trim().min(1).max(2048),
  isConfigured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isPublished: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const adminOnly = requireAdminClaims(auth.claims);
  if (adminOnly) {
    return adminOnly;
  }
  try {
    const data = await proxyInternalGet<PaymentProviderConfigRow[]>({
      path: "/api/v2/payments/ops/configuration/providers",
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}

export async function POST(request: NextRequest) {
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
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }
  const parsed = createBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const data = await proxyInternalPost<PaymentProviderConfigRow>({
      path: "/api/v2/payments/ops/configuration/providers",
      body: parsed.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
