import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { OpsPaymentActionResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet, ProxyUpstreamError } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";

const paramSchema = z.object({
  paymentId: z.string().trim().min(1).max(64),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { paymentId } = await params;
  const parsed = paramSchema.safeParse({ paymentId });
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid paymentId" }, { status: 400 });
  }

  try {
    const encoded = encodeURIComponent(parsed.data.paymentId);
    const data = await proxyInternalGet<OpsPaymentActionResponse>({
      path: `/api/v2/payments/ops/payments/${encoded}/action`,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof ProxyUpstreamError && error.upstreamStatus === 404) {
      return NextResponse.json({ message: "Payment not found" }, { status: 404 });
    }
    if (
      auth.claims.role === "merchant" &&
      error instanceof ProxyUpstreamError &&
      error.upstreamStatus === 403
    ) {
      return NextResponse.json({ message: "Payment not found" }, { status: 404 });
    }
    return mapProxyError(error);
  }
}
