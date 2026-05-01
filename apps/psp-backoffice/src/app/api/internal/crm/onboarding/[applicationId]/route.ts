import { NextRequest, NextResponse } from "next/server";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { tryDecodeRoutePathSegment } from "@/lib/server/decode-route-path-segment";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const adminBlock = requireAdminClaims(auth.claims);
  if (adminBlock) {
    return adminBlock;
  }

  const { applicationId: rawId } = await context.params;
  const decoded = tryDecodeRoutePathSegment(rawId);
  if (!decoded.ok) {
    return NextResponse.json({ message: "Invalid application id" }, { status: 400 });
  }

  try {
    const encoded = encodeURIComponent(decoded.value);
    const data = await proxyInternalGet<unknown>({
      path: `/api/v1/merchant-onboarding/ops/applications/${encoded}`,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
