import { NextRequest, NextResponse } from "next/server";
import type { MerchantOnboardingTokenResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyPublicGet } from "@/lib/server/backoffice-api";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const token = decodeURIComponent(rawToken);

  try {
    const data = await proxyPublicGet<MerchantOnboardingTokenResponse>({
      path: `/api/v1/merchant-onboarding/tokens/${encodeURIComponent(token)}`,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
