import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { MerchantOnboardingApplicationListItem } from "@/lib/api/contracts";
import { mapProxyError, proxyPublicPost } from "@/lib/server/backoffice-api";

type RouteContext = { params: Promise<{ token: string }> };

const businessProfileSchema = z.object({
  tradeName: z.string().min(2).max(160),
  legalName: z.string().min(2).max(200),
  country: z.string().length(2).transform((v) => v.toUpperCase()),
  website: z.string().url().max(2048).optional().or(z.literal("").transform(() => undefined)),
  businessType: z.string().min(2).max(120),
});

export async function POST(request: NextRequest, context: RouteContext) {
  const { token: rawToken } = await context.params;
  const token = decodeURIComponent(rawToken);

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
    const data = await proxyPublicPost<MerchantOnboardingApplicationListItem>({
      path: `/api/v1/merchant-onboarding/tokens/${encodeURIComponent(token)}/business-profile`,
      body: bodyParse.data,
    });
    return NextResponse.json(data);
  } catch (error) {
    return mapProxyError(error);
  }
}
