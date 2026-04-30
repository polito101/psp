import { NextRequest, NextResponse } from "next/server";
import { mapProxyError, proxyInternalPost } from "@/lib/server/backoffice-api";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
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

  const { applicationId: rawApplicationId } = await context.params;
  const applicationId = decodeURIComponent(rawApplicationId);

  try {
    const data = await proxyInternalPost<{ ok: true; message: string }>({
      path: `/api/v1/merchant-onboarding/ops/applications/${encodeURIComponent(applicationId)}/resend-link`,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
