import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { MerchantsOpsMerchantSummary } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPatch } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string }> };

const bodySchema = z.object({
  isActive: z.boolean(),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const adminBlock = requireAdminClaims(auth.claims);
  if (adminBlock) {
    return adminBlock;
  }

  const { merchantId: rawMerchantId } = await context.params;
  const merchantId = decodeURIComponent(rawMerchantId);

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
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalPatch<MerchantsOpsMerchantSummary>({
      path: `/api/v1/merchants/ops/${encoded}/active`,
      body: bodyParse.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
