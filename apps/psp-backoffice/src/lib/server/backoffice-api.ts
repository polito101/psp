import { NextResponse } from "next/server";

const DEFAULT_API_BASE_URL = "http://localhost:3000";

type ProxyRequestOptions = {
  path: string;
  searchParams?: URLSearchParams;
};

function getServerConfig() {
  const apiBaseUrl = process.env.PSP_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const internalSecret = process.env.PSP_INTERNAL_API_SECRET;

  if (!internalSecret) {
    throw new Error("Missing PSP_INTERNAL_API_SECRET in backoffice environment");
  }

  return { apiBaseUrl, internalSecret };
}

export async function proxyInternalGet<T>(options: ProxyRequestOptions): Promise<T> {
  const { apiBaseUrl, internalSecret } = getServerConfig();
  const url = new URL(options.path, apiBaseUrl);
  if (options.searchParams) {
    options.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-Internal-Secret": internalSecret,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`PSP API ${response.status}: ${raw || "empty response"}`);
  }

  return (await response.json()) as T;
}

export function mapProxyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unhandled proxy error";
  return NextResponse.json({ message }, { status: 502 });
}
