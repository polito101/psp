import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { OpsTransactionCountsResponse } from "@/lib/api/contracts";
import { OPS_PAYMENT_PROVIDERS } from "@/lib/api/payment-providers";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { forbiddenScopeResponse } from "@/lib/server/internal-route-scope";

const querySchema = z.object({
  merchantId: z.string().trim().min(1).max(64).optional(),
  paymentId: z.string().trim().min(1).max(64).optional(),
  provider: z.enum(OPS_PAYMENT_PROVIDERS).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  payerCountry: z.string().trim().length(2).optional(),
  paymentMethodCode: z.string().trim().min(1).max(64).optional(),
  paymentMethodFamily: z.string().trim().min(1).max(32).optional(),
  weekday: z.coerce.number().int().min(0).max(6).optional(),
  merchantActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : v === "true" ? true : undefined)),
});

export async function GET(request: NextRequest) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const parse = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parse.success) {
    return NextResponse.json(
      {
        message: "Invalid filters",
        issues: parse.error.issues,
      },
      { status: 400 },
    );
  }

  const { claims } = auth;
  let queryData = parse.data;
  if (claims.role === "merchant") {
    if (queryData.merchantId !== undefined && queryData.merchantId !== claims.merchantId) {
      return forbiddenScopeResponse();
    }
    queryData = { ...queryData, merchantId: claims.merchantId };
  }

  try {
    const params = new URLSearchParams();
    Object.entries(queryData).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    });

    const data = await proxyInternalGet<OpsTransactionCountsResponse>({
      path: "/api/v2/payments/ops/transactions/counts",
      searchParams: params,
      backofficeScope: claims,
    });

    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
