import { NextRequest, NextResponse } from "next/server";
import type { ProviderHealthResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type OpsMetricsPayload = {
  circuitBreakers?: Record<string, { failures: number; open: boolean; openedUntil: number }>;
};

export async function GET(request: NextRequest) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const adminOnly = requireAdminClaims(auth.claims);
  if (adminOnly) {
    return adminOnly;
  }

  try {
    const metrics = await proxyInternalGet<OpsMetricsPayload>({
      path: "/api/v2/payments/ops/metrics",
      backofficeScope: auth.claims,
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
