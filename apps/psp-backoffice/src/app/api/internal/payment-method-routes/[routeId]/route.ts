import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PaymentMethodRouteRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalPatch } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

type RouteContext = { params: Promise<{ routeId: string }> };

const channelSchema = z.enum(["CASH", "ONLINE", "CREDIT_CARD", "CRYPTO"]);
const modeSchema = z.enum(["S2S", "REDIRECTION", "HOSTED_PAGE"]);
const templateSchema = z.enum(["REDIRECT_SIMPLE", "SPEI_BANK_TRANSFER"]);

const currencyInputSchema = z.object({
  currency: z.string().trim().min(3).max(8),
  minAmount: z.coerce.number().finite(),
  maxAmount: z.coerce.number().finite(),
  isDefault: z.boolean().optional(),
});

/** Actualización parcial; si `currencies` viene, sustituye el conjunto en upstream. */
const patchRouteSchema = z
  .object({
    methodCode: z.string().trim().min(1).max(64).optional(),
    methodName: z.string().trim().min(1).max(160).optional(),
    countryCode: z.string().trim().length(2).optional(),
    countryName: z.string().trim().max(120).nullable().optional(),
    countryImageName: z.string().trim().max(120).nullable().optional(),
    channel: channelSchema.optional(),
    integrationMode: modeSchema.optional(),
    requestTemplate: templateSchema.optional(),
    integrationCode: z.string().trim().max(120).nullable().optional(),
    checkoutUrlTemplate: z.string().trim().max(2048).nullable().optional(),
    expirationTimeOffset: z.coerce.number().int().optional(),
    weight: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
    isPublished: z.boolean().optional(),
    routeConfigJson: z.record(z.string(), z.unknown()).nullable().optional(),
    currencies: z.array(currencyInputSchema).min(1).optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, context: RouteContext) {
  const mutation = enforceInternalMutationRequest(request);
  if (!mutation.ok) {
    return mutation.response;
  }
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const adminOnly = requireAdminClaims(auth.claims);
  if (adminOnly) {
    return adminOnly;
  }
  const { routeId: rawId } = await context.params;
  let routeId: string;
  try {
    routeId = decodeURIComponent(rawId);
  } catch {
    return NextResponse.json({ message: "Invalid routeId" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }
  const parsed = patchRouteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ message: "Body must include at least one field" }, { status: 400 });
  }
  const body: Record<string, unknown> = { ...parsed.data };
  if (typeof body.countryCode === "string") {
    body.countryCode = body.countryCode.toUpperCase();
  }
  if (Array.isArray(body.currencies)) {
    body.currencies = (body.currencies as z.infer<typeof currencyInputSchema>[]).map((c) => ({
      ...c,
      currency: c.currency.toUpperCase(),
    }));
  }
  try {
    const encoded = encodeURIComponent(routeId);
    const data = await proxyInternalPatch<PaymentMethodRouteRow>({
      path: `/api/v2/payments/ops/configuration/routes/${encoded}`,
      body,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
