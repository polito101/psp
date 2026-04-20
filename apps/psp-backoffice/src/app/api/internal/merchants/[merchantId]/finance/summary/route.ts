import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { MerchantFinanceSummaryResponse } from "@/lib/api/contracts";
import { OPS_PAYMENT_PROVIDERS } from "@/lib/api/payment-providers";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";

const paramSchema = z.object({
  merchantId: z.string().trim().min(1).max(64),
});

const querySchema = z
  .object({
    provider: z.enum(OPS_PAYMENT_PROVIDERS).optional(),
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/)
      .optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.createdFrom || !value.createdTo) return;
    const from = new Date(value.createdFrom);
    const to = new Date(value.createdTo);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return;
    if (from.getTime() > to.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "createdFrom must be before or equal to createdTo",
        path: ["createdTo"],
      });
    }
  });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchantId: string }> },
) {
  const unauthorizedResponse = enforceInternalRouteAuth(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const { merchantId } = await params;
  const parsedParams = paramSchema.safeParse({ merchantId });
  if (!parsedParams.success) {
    return NextResponse.json({ message: "Invalid merchantId" }, { status: 400 });
  }

  const parse = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parse.success) {
    return NextResponse.json(
      { message: "Invalid filters", issues: parse.error.issues },
      { status: 400 },
    );
  }

  try {
    const searchParams = new URLSearchParams();
    Object.entries(parse.data).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    });

    const encoded = encodeURIComponent(parsedParams.data.merchantId);
    const data = await proxyInternalGet<MerchantFinanceSummaryResponse>({
      path: `/api/v2/payments/ops/merchants/${encoded}/finance/summary`,
      searchParams: searchParams.size > 0 ? searchParams : undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
