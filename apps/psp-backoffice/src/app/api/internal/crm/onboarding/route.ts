import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type {
  MerchantOnboardingApplicationsResponse,
  MerchantOnboardingStatus,
} from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

const ONBOARDING_STATUSES = [
  "ACCOUNT_CREATED",
  "DOCUMENTATION_PENDING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "ACTIVE",
] as const satisfies readonly MerchantOnboardingStatus[];

const querySchema = z.object({
  status: z.enum(ONBOARDING_STATUSES).optional(),
  q: z.string().max(320).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const adminBlock = requireAdminClaims(auth.claims);
  if (adminBlock) {
    return adminBlock;
  }

  const parse = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parse.success) {
    return NextResponse.json(
      { message: "Invalid query", issues: parse.error.issues },
      { status: 400 },
    );
  }

  const params = new URLSearchParams();
  if (parse.data.status) params.set("status", parse.data.status);
  if (parse.data.q) params.set("q", parse.data.q);
  if (parse.data.pageSize) params.set("pageSize", String(parse.data.pageSize));

  try {
    const data = await proxyInternalGet<MerchantOnboardingApplicationsResponse>({
      path: "/api/v1/merchant-onboarding/ops/applications",
      searchParams: params,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
