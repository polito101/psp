import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mapProxyError, proxyInternalPost } from "@/lib/server/backoffice-api";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ applicationId: string }> };

const bodySchema = z.object({
  reason: z.string().min(3).max(2000),
});

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

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }

  const bodyParse = bodySchema.safeParse(json);
  if (!bodyParse.success) {
    return NextResponse.json(
      { message: "Invalid body", issues: bodyParse.error.issues },
      { status: 400 },
    );
  }

  try {
    const data = await proxyInternalPost<unknown>({
      path: `/api/v1/merchant-onboarding/ops/applications/${encodeURIComponent(applicationId)}/reject`,
      body: bodyParse.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
