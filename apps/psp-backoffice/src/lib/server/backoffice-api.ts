import { NextResponse } from "next/server";

const DEFAULT_API_BASE_URL = "http://localhost:3000";
const DEFAULT_PROXY_TIMEOUT_MS = 5000;

type ProxyRequestOptions = {
  path: string;
  searchParams?: URLSearchParams;
};

function validateAndNormalizeApiOrigin(rawBaseUrl: string): string {
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error(
      'PSP_API_BASE_URL is invalid. Expected an absolute URL (e.g. https://example.com or http://localhost:3000).',
    );
  }

  const isLocalhostException =
    parsedBaseUrl.hostname === "localhost" ||
    parsedBaseUrl.hostname === "127.0.0.1" ||
    parsedBaseUrl.hostname === "::1";

  if (
    parsedBaseUrl.protocol !== "https:" &&
    !(parsedBaseUrl.protocol === "http:" && isLocalhostException)
  ) {
    throw new Error(
      `Refusing PSP_API_BASE_URL with protocol "${parsedBaseUrl.protocol}". Use https, or http only for localhost/127.0.0.1/::1.`,
    );
  }

  return parsedBaseUrl.origin;
}

function getServerConfig() {
  const apiBaseUrlRaw = process.env.PSP_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const apiBaseOrigin = validateAndNormalizeApiOrigin(apiBaseUrlRaw);
  const internalSecret = process.env.PSP_INTERNAL_API_SECRET;

  if (!internalSecret) {
    throw new Error("Missing PSP_INTERNAL_API_SECRET in backoffice environment");
  }

  return { apiBaseOrigin, internalSecret };
}

export async function proxyInternalGet<T>(options: ProxyRequestOptions): Promise<T> {
  const { apiBaseOrigin, internalSecret } = getServerConfig();
  const url = new URL(options.path, apiBaseOrigin);
  if (options.searchParams) {
    options.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_PROXY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "X-Internal-Secret": internalSecret,
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "<missing>";
    throw new Error(
      `PSP API returned redirect (${response.status}) to "${location}". Redirects are not allowed when sending internal secrets.`,
    );
  }

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`PSP API ${response.status}: ${raw || "empty response"}`);
  }

  return (await response.json()) as T;
}

export function mapProxyError(error: unknown) {
  console.error("backoffice_proxy_error", error);
  return NextResponse.json(
    { message: "Upstream service unavailable" },
    { status: 502 },
  );
}
