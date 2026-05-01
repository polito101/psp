import { NextRequest, NextResponse } from "next/server";
import { mapProxyError, proxyPublicGet } from "@/lib/server/backoffice-api";
import { tryDecodeRoutePathSegment } from "@/lib/server/decode-route-path-segment";

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const decoded = tryDecodeRoutePathSegment(rawToken);
  if (!decoded.ok) {
    return NextResponse.json({ message: "Invalid token" }, { status: 400 });
  }

  try {
    const encoded = encodeURIComponent(decoded.value);
    const data = await proxyPublicGet<unknown>(`/api/v1/merchant-onboarding/tokens/${encoded}`);
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
