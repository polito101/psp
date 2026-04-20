import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { OpsTransactionsResponse } from "@/lib/api/contracts";
import { OPS_PAYMENT_PROVIDERS } from "@/lib/api/payment-providers";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { forbiddenScopeResponse } from "@/lib/server/internal-route-scope";

const querySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  direction: z.enum(["next", "prev"]).optional().default("next"),
  cursorCreatedAt: z.string().datetime().optional(),
  cursorId: z.string().trim().min(1).max(64).optional(),
  merchantId: z.string().trim().min(1).max(64).optional(),
  paymentId: z.string().trim().min(1).max(64).optional(),
  status: z
    .enum([
      "pending",
      "processing",
      "requires_action",
      "authorized",
      "succeeded",
      "disputed",
      "dispute_lost",
      "failed",
      "canceled",
      "refunded",
    ])
    .optional(),
  provider: z.enum(OPS_PAYMENT_PROVIDERS).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  includeTotal: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : v === "true" ? true : undefined)),
}).superRefine((value, ctx) => {
  const hasCreatedAt = Boolean(value.cursorCreatedAt);
  const hasId = Boolean(value.cursorId);
  if (hasCreatedAt !== hasId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cursorCreatedAt and cursorId must be provided together",
      path: ["cursorCreatedAt"],
    });
  }
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

    const data = await proxyInternalGet<OpsTransactionsResponse>({
      path: "/api/v2/payments/ops/transactions",
      searchParams: params,
      backofficeScope: claims,
    });

    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
