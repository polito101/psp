import { NextResponse } from "next/server";
import type { ProviderHealthResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";

type OpsMetricsPayload = {
  circuitBreakers?: Record<string, { failures: number; open: boolean; openedUntil: number }>;
};

export async function GET() {
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
