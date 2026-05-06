import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { OpsPaymentDetailResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet, ProxyUpstreamError } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";

const paramSchema = z.object({
  paymentId: z.string().trim().min(1).max(64),
});

function stripSensitiveJsonKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripSensitiveJsonKeys);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/ciphertext/i.test(k)) {
      continue;
    }
    out[k] = stripSensitiveJsonKeys(v);
  }
  return out;
}

/** Defensa en profundidad: no exponer ciphertext aunque el upstream lo envíe por error. */
function sanitizeOpsPaymentDetailResponse(data: OpsPaymentDetailResponse): OpsPaymentDetailResponse {
  return {
    payment: stripSensitiveJsonKeys(data.payment) as OpsPaymentDetailResponse["payment"],
    providerLogs: stripSensitiveJsonKeys(data.providerLogs) as OpsPaymentDetailResponse["providerLogs"],
    notificationDeliveries: stripSensitiveJsonKeys(
      data.notificationDeliveries,
    ) as OpsPaymentDetailResponse["notificationDeliveries"],
    action: data.action,
  };
}

export async function GET(
  request: NextRequest,
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
    const searchParams = new URLSearchParams();
    if (request.nextUrl.searchParams.get("includePayload") === "true") {
      searchParams.set("includePayload", "true");
    }
    const data = await proxyInternalGet<OpsPaymentDetailResponse>({
      path: `/api/v2/payments/ops/payments/${encoded}`,
      searchParams: searchParams.size > 0 ? searchParams : undefined,
      backofficeScope: auth.claims,
    });
    const safe = sanitizeOpsPaymentDetailResponse(data);
    if (auth.claims.role === "merchant" && safe.payment.merchantId !== auth.claims.merchantId) {
      return NextResponse.json({ message: "Payment not found" }, { status: 404 });
    }
    return NextResponse.json(safe);
  } catch (error) {
    if (error instanceof ProxyUpstreamError && error.upstreamStatus === 404) {
      return NextResponse.json({ message: "Payment not found" }, { status: 404 });
    }
    // Defense-in-depth: older upstream (or other scope 403) must not let merchants distinguish 403 vs 404.
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
