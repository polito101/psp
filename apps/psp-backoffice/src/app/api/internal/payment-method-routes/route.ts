import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PaymentMethodRouteRow } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet, proxyInternalPost } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { enforceInternalMutationRequest } from "@/lib/server/internal-mutation-guard";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

const channelSchema = z.enum(["CASH", "ONLINE", "CREDIT_CARD", "CRYPTO"]);
const modeSchema = z.enum(["S2S", "REDIRECTION", "HOSTED_PAGE"]);
const templateSchema = z.enum(["REDIRECT_SIMPLE", "SPEI_BANK_TRANSFER"]);

const listQuerySchema = z.object({
  countryCode: z.string().trim().length(2).optional(),
  providerId: z.string().trim().min(1).max(64).optional(),
  channel: channelSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "false" ? false : v === "true" ? true : undefined)),
});

const currencyInputSchema = z.object({
  currency: z.string().trim().min(3).max(8),
  minAmount: z.coerce.number().finite(),
  maxAmount: z.coerce.number().finite(),
  isDefault: z.boolean().optional(),
});

const createRouteSchema = z.object({
  providerId: z.string().trim().min(1),
  methodCode: z.string().trim().min(1).max(64),
  methodName: z.string().trim().min(1).max(160),
  countryCode: z.string().trim().length(2),
  countryName: z.string().trim().max(120).optional(),
  countryImageName: z.string().trim().max(120).optional(),
  channel: channelSchema,
  integrationMode: modeSchema,
  requestTemplate: templateSchema,
  integrationCode: z.string().trim().max(120).optional(),
  checkoutUrlTemplate: z.string().trim().max(2048).optional(),
  expirationTimeOffset: z.coerce.number().int().optional(),
  weight: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  routeConfigJson: z.record(z.string(), z.unknown()).optional(),
  currencies: z.array(currencyInputSchema).min(1),
});

export async function GET(request: NextRequest) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }
  const adminOnly = requireAdminClaims(auth.claims);
  if (adminOnly) {
    return adminOnly;
  }
  const parse = listQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parse.success) {
    return NextResponse.json({ message: "Invalid query", issues: parse.error.issues }, { status: 400 });
  }
  const params = new URLSearchParams();
  const q = parse.data;
  if (q.countryCode) params.set("countryCode", q.countryCode.toUpperCase());
  if (q.providerId) params.set("providerId", q.providerId);
  if (q.channel) params.set("channel", q.channel);
  if (q.isActive === true) params.set("isActive", "true");
  if (q.isActive === false) params.set("isActive", "false");
  try {
    const data = await proxyInternalGet<PaymentMethodRouteRow[]>({
      path: "/api/v2/payments/ops/configuration/routes",
      searchParams: params,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}

export async function POST(request: NextRequest) {
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
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }
  const parsed = createRouteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const body = {
    ...parsed.data,
    countryCode: parsed.data.countryCode.toUpperCase(),
    currencies: parsed.data.currencies.map((c) => ({
      ...c,
      currency: c.currency.toUpperCase(),
    })),
  };
  try {
    const data = await proxyInternalPost<PaymentMethodRouteRow>({
      path: "/api/v2/payments/ops/configuration/routes",
      body,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
