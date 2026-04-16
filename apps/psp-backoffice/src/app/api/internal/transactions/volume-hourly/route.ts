import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { OpsVolumeHourlyResponse } from "@/lib/api/contracts";
import { mapProxyError, proxyInternalGet } from "@/lib/server/backoffice-api";
import { enforceInternalRouteAuth } from "@/lib/server/internal-route-auth";

const querySchema = z.object({
  merchantId: z.string().trim().min(1).max(64).optional(),
  provider: z.enum(["stripe", "mock"]).optional(),
  currency: z
    .string()
    .length(3)
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/))
    .optional(),
});

export async function GET(request: NextRequest) {
  const unauthorizedResponse = enforceInternalRouteAuth(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const parse = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parse.success) {
    return NextResponse.json(
      {
        message: "Invalid filters",
        issues: parse.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const params = new URLSearchParams();
    Object.entries(parse.data).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    });

    const data = await proxyInternalGet<OpsVolumeHourlyResponse>({
      path: "/api/v2/payments/ops/transactions/volume-hourly",
      searchParams: params,
    });

    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
