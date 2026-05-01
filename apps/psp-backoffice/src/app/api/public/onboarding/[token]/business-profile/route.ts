import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mapProxyError, proxyPublicPost } from "@/lib/server/backoffice-api";
import { tryDecodeRoutePathSegment } from "@/lib/server/decode-route-path-segment";

type RouteContext = { params: Promise<{ token: string }> };

const businessProfileSchema = z.object({
  tradeName: z.string().min(2).max(160),
  legalName: z.string().min(2).max(200),
  country: z.string().length(2).transform((v) => v.toUpperCase()),
  website: z
    .union([z.literal(""), z.string().url().max(2048)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  businessType: z.string().min(2).max(120),
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const decoded = tryDecodeRoutePathSegment(rawToken);
  if (!decoded.ok) {
    return NextResponse.json({ message: "Invalid token" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ message: "Expected JSON body" }, { status: 400 });
  }

  const bodyParse = businessProfileSchema.safeParse(json);
  if (!bodyParse.success) {
    return NextResponse.json(
      { message: "Invalid body", issues: bodyParse.error.issues },
      { status: 400 },
    );
  }

  try {
    const encoded = encodeURIComponent(decoded.value);
    const data = await proxyPublicPost<unknown>(
      `/api/v1/merchant-onboarding/tokens/${encoded}/business-profile`,
      bodyParse.data,
    );
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
