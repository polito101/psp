import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { OpsPaymentDetailResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";

const paramSchema = z.object({
  paymentId: z.string().trim().min(1).max(64),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const unauthorizedResponse = enforceInternalRouteAuth(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const { paymentId } = await params;
  const parsed = paramSchema.safeParse({ paymentId });
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid paymentId" }, { status: 400 });
  }

  try {
    const encoded = encodeURIComponent(parsed.data.paymentId);
    const searchParams = new URLSearchParams();
    if (request.nextUrl.searchParams.get("includePayload") === "true") {
      searchParams.set("includePayload", "true");
    }
    const data = await proxyInternalGet<OpsPaymentDetailResponse>({
      path: `/api/v2/payments/ops/payments/${encoded}`,
      searchParams: searchParams.size > 0 ? searchParams : undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled proxy error";
    if (message.includes("PSP API 404")) {
      return NextResponse.json({ message: "Payment not found" }, { status: 404 });
    }
    return mapProxyError(error);
  }
}
