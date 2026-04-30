import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SettlementRequestRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPost } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ requestId: string }> };

const bodySchema = z.object({
  reviewedNotes: z.string().max(2000).optional(),
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

  const { requestId: rawId } = await context.params;
  const requestId = decodeURIComponent(rawId);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const bodyParse = bodySchema.safeParse(json);
  if (!bodyParse.success) {
    return NextResponse.json(
      { message: "Invalid body", issues: bodyParse.error.issues },
      { status: 400 },
    );
  }

  try {
    const encoded = encodeURIComponent(requestId);
    const data = await proxyInternalPost<SettlementRequestRow>({
      path: `/api/v1/settlements/requests/${encoded}/reject`,
      body: bodyParse.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
