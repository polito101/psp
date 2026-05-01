import { NextRequest, NextResponse } from "next/server";
import { mapProxyError, proxyInternalPost } from "@/lib/server/backoffice-api";
import { tryDecodeRoutePathSegment } from "@/lib/server/decode-route-path-segment";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const mutation = enforceInternalMutationRequest(request);
  if (!mutation.ok) {
    return mutation.response;
  }

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
    const data = await proxyInternalPost<unknown>({
      path: `/api/v1/merchant-onboarding/ops/applications/${encoded}/resend-link`,
      body: {},
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
