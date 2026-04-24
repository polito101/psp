import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SettlementRequestRow, SettlementRequestsListResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet, proxyInternalPost } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceMerchantScope } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string }> };

const postBodySchema = z.object({
  notes: z.string().max(2000).optional(),
});

const currencyQuerySchema = z.object({
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

  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalGet<SettlementRequestsListResponse>({
      path: `/api/v1/settlements/merchants/${encoded}/requests`,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const bodyParse = postBodySchema.safeParse(json);
  if (!bodyParse.success) {
    return NextResponse.json(
      { message: "Invalid body", issues: bodyParse.error.issues },
      { status: 400 },
    );
  }

  const qParse = currencyQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  if (!qParse.success) {
    return NextResponse.json(
      { message: "Invalid query", issues: qParse.error.issues },
      { status: 400 },
    );
  }

  const params = new URLSearchParams();
  if (qParse.data.currency) {
    params.set("currency", qParse.data.currency.toUpperCase());
  }

  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalPost<SettlementRequestRow>({
      path: `/api/v1/settlements/merchants/${encoded}/requests`,
      searchParams: params,
      body: bodyParse.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
