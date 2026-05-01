import { NextRequest, NextResponse } from "next/server";
import {
  resolveLoginRateLimitClientIp,
  resolveLoginRateLimitKey,
} from "@/lib/server/client-ip";
import { checkMerchantOnboardingPublicRateLimit } from "@/lib/server/merchant-onboarding-public-rate-limit";

function getPspApiBaseUrl(): string | null {
  const raw = process.env.PSP_API_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function parseProxyTimeoutMs(): number {
  const raw = process.env.PSP_API_PROXY_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return 10_000;
  const n = Number(raw);
  if (n < 1 || n > 120_000) return 10_000;
  return n;
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store" },
  });
}

/**
 * Proxy público hacia `POST /api/v1/merchant-onboarding/applications` con rate limit por IP
 * (o fingerprint) y reenvío de identidad de cliente hacia `psp-api` para el throttler global.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const baseUrl = getPspApiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ message: "Signup is not configured" }, { status: 500 });
  }

  const rateLimit = checkMerchantOnboardingPublicRateLimit(resolveLoginRateLimitKey(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSec),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const timeoutMs = parseProxyTimeoutMs();

  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const clientIp = resolveLoginRateLimitClientIp(request);
  if (clientIp) {
    upstreamHeaders["X-Forwarded-For"] = clientIp;
    upstreamHeaders["X-Real-IP"] = clientIp;
  }

  const xfProto = request.headers.get("x-forwarded-proto");
  if (xfProto) {
    upstreamHeaders["X-Forwarded-Proto"] = xfProto;
  }

  const xfHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (xfHost) {
    upstreamHeaders["X-Forwarded-Host"] = xfHost;
  }

  try {
    const response = await fetch(new URL("/api/v1/merchant-onboarding/applications", baseUrl), {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({ message: "Unexpected response" }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return NextResponse.json(
      { message: aborted ? "Upstream timeout" : "Upstream request failed" },
      { status: aborted ? 504 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
