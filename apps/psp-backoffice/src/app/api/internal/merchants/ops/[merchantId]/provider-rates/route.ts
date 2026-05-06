import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { MerchantProviderRateRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet, proxyInternalPost } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string }> };

const upsertBodySchema = z.object({
  providerId: z.string().trim().min(1),
  countryCode: z.string().trim().length(2),
  percentage: z.coerce.number().min(0).max(100),
  fixed: z.coerce.number().min(0),
  minRateDiscount: z.coerce.number().min(0).optional(),
  applyToCustomer: z.boolean().optional(),
  fxSpread: z.coerce.number().min(0).max(100).optional(),
  fxMarkup: z.coerce.number().min(0).max(100).optional(),
  disableIndustryValidation: z.boolean().optional(),
  cashEnabled: z.boolean().optional(),
  creditCardEnabled: z.boolean().optional(),
  cryptoEnabled: z.boolean().optional(),
  onlineEnabled: z.boolean().optional(),
  cashMinAmount: z.coerce.number().min(0).optional(),
  creditCardMinAmount: z.coerce.number().min(0).optional(),
  cryptoMinAmount: z.coerce.number().min(0).optional(),
  onlineMinAmount: z.coerce.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const adminOnly = requireAdminClaims(auth.claims);
  if (adminOnly) {
    return adminOnly;
  }
  const { merchantId: raw } = await context.params;
  let merchantId: string;
  try {
    merchantId = decodeURIComponent(raw);
  } catch {
    return NextResponse.json({ message: "Invalid merchantId" }, { status: 400 });
  }
  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalGet<MerchantProviderRateRow[]>({
      path: `/api/v2/payments/ops/configuration/merchants/${encoded}/provider-rates`,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
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
  const { merchantId: raw } = await context.params;
  let merchantId: string;
  try {
    merchantId = decodeURIComponent(raw);
  } catch {
    return NextResponse.json({ message: "Invalid merchantId" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }
  const parsed = upsertBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const body = {
    ...parsed.data,
    countryCode: parsed.data.countryCode.toUpperCase(),
  };
  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalPost<MerchantProviderRateRow>({
      path: `/api/v2/payments/ops/configuration/merchants/${encoded}/provider-rates`,
      body,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
