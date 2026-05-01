import { NextRequest, NextResponse } from "next/server";
import type { MerchantOnboardingApplicationDetail } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const adminBlock = requireAdminClaims(auth.claims);
  if (adminBlock) {
    return adminBlock;
  }

  const { applicationId: rawApplicationId } = await context.params;
  const applicationId = decodeURIComponent(rawApplicationId);

  try {
    const data = await proxyInternalGet<MerchantOnboardingApplicationDetail>({
      path: `/api/v1/merchant-onboarding/ops/applications/${encodeURIComponent(applicationId)}`,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
