import { NextRequest, NextResponse } from "next/server";
import type { MerchantsOpsDirectoryResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";
import { requireAdminClaims } from "@/lib/server/internal-route-scope";

export async function GET(request: NextRequest) {
  const auth = await enforceInternalRouteAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  const adminBlock = requireAdminClaims(auth.claims);
  if (adminBlock) {
    return adminBlock;
  }

  try {
    const data = await proxyInternalGet<MerchantsOpsDirectoryResponse>({
      path: "/api/v1/merchants/ops/directory",
      backofficeScope: auth.claims,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
