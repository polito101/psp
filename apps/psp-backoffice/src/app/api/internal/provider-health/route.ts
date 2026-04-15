import { NextRequest, NextResponse } from "next/server";
import type { ProviderHealthResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";

type OpsMetricsPayload = {
  circuitBreakers?: Record<string, { failures: number; open: boolean; openedUntil: number }>;
};

export async function GET(request: NextRequest) {
  const unauthorizedResponse = enforceInternalRouteAuth(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  try {
    const metrics = await proxyInternalGet<OpsMetricsPayload>({
      path: "/api/v2/payments/ops/metrics",
    });

    const providers = Object.entries(metrics.circuitBreakers ?? {}).map(([provider, state]) => ({
      provider,
      open: Boolean(state.open),
      failures: Number(state.failures ?? 0),
      openedUntil: Number(state.openedUntil ?? 0),
    }));

    const payload: ProviderHealthResponse = { providers };
    return NextResponse.json(payload);
  } catch (error) {
    return mapProxyError(error);
  }
}
