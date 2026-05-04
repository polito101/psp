import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { MerchantsOpsMerchantSummary } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPatch } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ merchantId: string }> };

const registrationStatusSchema = z.enum(["LEAD", "IN_REVIEW", "APPROVED", "REJECTED", "ACTIVE"]);
const industrySchema = z.enum(["CLOUD_COMPUTING", "CRYPTO", "FOREX", "GAMBLING", "PSP", "OTHER"]);

const bodySchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(320).optional(),
  contactName: z.string().trim().min(2).max(160).optional(),
  contactPhone: z.string().trim().min(6).max(64).optional(),
  websiteUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  isActive: z.boolean().optional(),
  registrationStatus: registrationStatusSchema.optional(),
  registrationNumber: z
    .string()
    .trim()
    .max(64)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  industry: industrySchema.optional(),
});

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    return NextResponse.json({ message: "Invalid body", issues: bodyParse.error.issues }, { status: 400 });
  }

  try {
    const encoded = encodeURIComponent(merchantId);
    const data = await proxyInternalPatch<MerchantsOpsMerchantSummary>({
      path: `/api/v1/merchants/ops/${encoded}/account`,
      body: bodyParse.data,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
