import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SettlementRequestsListResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

const SETTLEMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED", "PAID", "CANCELED"] as const;

const querySchema = z.object({
  status: z.enum(SETTLEMENT_STATUSES).optional(),
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
  if (parse.data.status) {
    params.set("status", parse.data.status);
  }

  try {
    const data = await proxyInternalGet<SettlementRequestsListResponse>({
      path: "/api/v1/settlements/requests/inbox",
      searchParams: params,
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
