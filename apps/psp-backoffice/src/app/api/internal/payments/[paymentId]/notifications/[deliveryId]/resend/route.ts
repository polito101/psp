import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ResendPaymentNotificationResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPost, ProxyUpstreamError } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";

const paramsSchema = z.object({
  paymentId: z.string().trim().min(1).max(64),
  deliveryId: z.string().trim().min(1).max(64),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string; deliveryId: string }> },
) {
  const mutation = enforceInternalMutationRequest(request);
  if (!mutation.ok) {
    return mutation.response;
  }

  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const resolved = await params;
  const parsed = paramsSchema.safeParse(resolved);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid parameters" }, { status: 400 });
  }

  try {
    const pe = encodeURIComponent(parsed.data.paymentId);
    const de = encodeURIComponent(parsed.data.deliveryId);
    const data = await proxyInternalPost<ResendPaymentNotificationResponse>({
      path: `/api/v2/payments/ops/payments/${pe}/notifications/${de}/resend`,
      body: {},
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ProxyUpstreamError && error.upstreamStatus === 404) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }
    if (
      auth.claims.role === "merchant" &&
      error instanceof ProxyUpstreamError &&
      error.upstreamStatus === 403
    ) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }
    return mapProxyError(error);
  }
}
