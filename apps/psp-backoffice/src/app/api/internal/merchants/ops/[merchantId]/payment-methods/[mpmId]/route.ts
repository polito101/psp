import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { MerchantPaymentMethodRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPatch } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceMerchantScope } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string; mpmId: string }> };

const bodySchema = z
  .object({
    merchantEnabled: z.boolean().optional(),
    adminEnabled: z.boolean().optional(),
    minAmountMinor: z.number().int().min(0).nullable().optional(),
    maxAmountMinor: z.number().int().min(0).nullable().optional(),
    visibleToMerchant: z.boolean().optional(),
    lastChangedBy: z.string().max(128).optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { merchantId: rawMerchantId, mpmId: rawMpmId } = await context.params;
  const merchantId = decodeURIComponent(rawMerchantId);
  const mpmId = decodeURIComponent(rawMpmId);

  const scopeErr = enforceMerchantScope(auth.claims, merchantId);
  if (scopeErr) {
    return scopeErr;
  }

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

  let body = bodyParse.data;
  if (auth.claims.role === "merchant") {
    const { merchantEnabled, minAmountMinor, maxAmountMinor, visibleToMerchant, lastChangedBy } = body;
    body = {
      ...(merchantEnabled !== undefined ? { merchantEnabled } : {}),
      ...(minAmountMinor !== undefined ? { minAmountMinor } : {}),
      ...(maxAmountMinor !== undefined ? { maxAmountMinor } : {}),
      ...(visibleToMerchant !== undefined ? { visibleToMerchant } : {}),
      ...(lastChangedBy !== undefined ? { lastChangedBy } : {}),
    };
    if (Object.keys(body).length === 0) {
      return NextResponse.json(
        { message: "Merchant scope may only update merchantEnabled, limits, visibleToMerchant, lastChangedBy" },
        { status: 400 },
      );
    }
  }

  try {
    const encMerchant = encodeURIComponent(merchantId);
    const encMpm = encodeURIComponent(mpmId);
    const data = await proxyInternalPatch<MerchantPaymentMethodRow>({
      path: `/api/v1/merchants/ops/${encMerchant}/payment-methods/${encMpm}`,
      body,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
