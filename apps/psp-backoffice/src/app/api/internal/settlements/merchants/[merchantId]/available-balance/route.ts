import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SettlementAvailableBalanceResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceMerchantScope } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string }> };

const querySchema = z.object({
  currency: z.string().trim().length(3).optional(),
});

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

  const parse = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parse.success) {
    return NextResponse.json(
      { message: "Invalid query", issues: parse.error.issues },
      { status: 400 },
    );
  }

  const params = new URLSearchParams();
  if (parse.data.currency) {
    params.set("currency", parse.data.currency.toUpperCase());
  }

  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalGet<SettlementAvailableBalanceResponse>({
      path: `/api/v1/settlements/merchants/${encoded}/available-balance`,
      searchParams: params,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
