import { NextRequest, NextResponse } from "next/server";
import type { MerchantsOpsDetailResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceMerchantScope } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { merchantId: rawMerchantId } = await context.params;
  const merchantId = decodeURIComponent(rawMerchantId);
  const scopeErr = enforceMerchantScope(auth.claims, merchantId);
  if (scopeErr) {
    return scopeErr;
  }

  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalGet<MerchantsOpsDetailResponse>({
      path: `/api/v1/merchants/ops/${encoded}/detail`,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
