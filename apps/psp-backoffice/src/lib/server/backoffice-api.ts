import { NextResponse } from "next/server";
import type { SessionClaims } from "@/lib/server/auth/session-claims";

const DEFAULT_API_BASE_URL = "http://localhost:3000";
/** Sin env: mismo orden que Render blueprint (`render.yaml`) para cold start / primera petición. */
const DEFAULT_PROXY_TIMEOUT_MS = 60_000;
const PROXY_TIMEOUT_MS_MIN = 1_000;
const PROXY_TIMEOUT_MS_MAX = 120_000;

let warnedInvalidPspApiProxyTimeoutMs = false;

function parseProxyTimeoutMs(): number {
  const raw = process.env.PSP_API_PROXY_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_PROXY_TIMEOUT_MS;
  if (!/^\d+$/.test(raw)) {
    if (!warnedInvalidPspApiProxyTimeoutMs) {
      warnedInvalidPspApiProxyTimeoutMs = true;
      console.warn(
        `[psp-backoffice] PSP_API_PROXY_TIMEOUT_MS is invalid (expected digits only, milliseconds). Got "${raw}". Using default ${DEFAULT_PROXY_TIMEOUT_MS}ms.`,
      );
    }
    return DEFAULT_PROXY_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PROXY_TIMEOUT_MS;
  return Math.min(PROXY_TIMEOUT_MS_MAX, Math.max(PROXY_TIMEOUT_MS_MIN, parsed));
}

/** Máximo de bytes leídos del cuerpo upstream en errores (evita OOM y payloads enormes). */
const PROXY_UPSTREAM_BODY_READ_MAX_BYTES = 64 * 1024;

/** Longitud máxima del preview en logs (caracteres, una sola línea saneada). */
const PROXY_UPSTREAM_LOG_PREVIEW_MAX_CHARS = 200;

type ProxyRequestOptions = {
  path: string;
  searchParams?: URLSearchParams;
  /** Alcance del caller BFF; se reenvía a psp-api para defensa en profundidad. */
  backofficeScope?: SessionClaims;
};

type ProxyWriteOptions = ProxyRequestOptions & {
  /** Cuerpo JSON (se serializa con `JSON.stringify` salvo que sea `string`). */
  body?: unknown;
};

/** Rutas internas de payments v2 ops: la API exige cabeceras RBAC fail-closed. */
export function isPaymentsV2OpsPath(path: string): boolean {
  return path.includes("/payments/ops/");
}

/** Match exacto del login merchant interno (`.../ops/merchant-login`), sin sufijos tipo `-audit`. */
function isMerchantOnboardingOpsMerchantLoginPath(path: string): boolean {
  return /(^|\/)merchant-onboarding\/ops\/merchant-login$/.test(path);
}

/** Incluye payments ops, settlements y merchants ops: el upstream exige cabeceras RBAC fail-closed. */
export function requiresBackofficeScopePath(path: string): boolean {
  if (isMerchantOnboardingOpsMerchantLoginPath(path)) {
    return false;
  }
  return (
    path.includes("/payments/ops/") ||
    path.includes("/settlements/") ||
    path.includes("/merchants/ops/") ||
    path.includes("/merchant-onboarding/ops/")
  );
}

/**
 * Resuelve `PSP_API_BASE_URL`. Fuera de `NODE_ENV=development` es obligatorio configurarlo;
 * en desarrollo local puede omitirse y usar `http://localhost:3000`.
 */
function getApiBaseUrlRaw(): string {
  const configured = process.env.PSP_API_BASE_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "development") return DEFAULT_API_BASE_URL;
  throw new Error("Missing PSP_API_BASE_URL in backoffice environment");
}

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
    parsedBaseUrl.hostname === "::1" ||
    parsedBaseUrl.hostname === "[::1]";

  if (
    parsedBaseUrl.protocol !== "https:" &&
    !(parsedBaseUrl.protocol === "http:" && isLocalhostException)
  ) {
    throw new Error(
      `Refusing PSP_API_BASE_URL with protocol "${parsedBaseUrl.protocol}". Use https, or http only for localhost/127.0.0.1/::1/[::1].`,
    );
  }

  return parsedBaseUrl.origin;
}

function getServerConfig() {
  const apiBaseOrigin = validateAndNormalizeApiOrigin(getApiBaseUrlRaw());
  const internalSecret = process.env.PSP_INTERNAL_API_SECRET;

  if (!internalSecret) {
    throw new Error("Missing PSP_INTERNAL_API_SECRET in backoffice environment");
  }

  return { apiBaseOrigin, internalSecret, proxyTimeoutMs: parseProxyTimeoutMs() };
}

function getPublicServerConfig() {
  const apiBaseOrigin = validateAndNormalizeApiOrigin(getApiBaseUrlRaw());
  return { apiBaseOrigin, proxyTimeoutMs: parseProxyTimeoutMs() };
}

function mergeUint8Arrays(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Lee el cuerpo como texto UTF-8 con un tope de bytes. Si se trunca, no se consume el resto del stream.
 * Sin `getReader()`, evita `response.text()` si el tamaño declarado supera el tope o es desconocido (anti-OOM).
 */
export async function readResponseTextWithByteLimit(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; measuredBodyBytes: number | null }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const rawCl = response.headers.get("content-length");
    const parsedCl = rawCl !== null ? Number.parseInt(rawCl, 10) : NaN;
    const clKnown = Number.isFinite(parsedCl) && parsedCl >= 0;

    if (!clKnown || parsedCl > maxBytes) {
      return { text: "", truncated: true, measuredBodyBytes: null };
    }

    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= maxBytes) {
      return { text, truncated: false, measuredBodyBytes: bytes.length };
    }
    const sliced = bytes.slice(0, maxBytes);
    return {
      text: new TextDecoder("utf-8", { fatal: false }).decode(sliced),
      truncated: true,
      measuredBodyBytes: sliced.length,
    };
  }

  const parts: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;

    if (total + value.length <= maxBytes) {
      parts.push(value);
      total += value.length;
    } else {
      parts.push(value.slice(0, maxBytes - total));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }

  const merged = mergeUint8Arrays(parts);
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(merged),
    truncated,
    measuredBodyBytes: merged.length,
  };
}

function sanitizeSingleLinePreview(text: string, maxChars: number): string {
  const withoutControls = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  const collapsed = withoutControls.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, maxChars);
}

/** Error cuando la API upstream responde con status no OK. El cuerpo no va en `message` (logs/PII). */
export class ProxyUpstreamError extends Error {
  /** Bytes UTF-8 del fragmento expuesto, o `null` si no se pudo medir sin leer el body completo. */
  readonly measuredBodyBytes: number | null;

  constructor(
    readonly upstreamStatus: number,
    readonly bodyText: string,
    readonly bodyTruncated: boolean = false,
    measuredBodyBytesArg?: number | null,
  ) {
    super(`PSP API ${upstreamStatus} (non-OK)`);
    this.name = "ProxyUpstreamError";
    this.measuredBodyBytes =
      measuredBodyBytesArg === undefined
        ? new TextEncoder().encode(bodyText).length
        : measuredBodyBytesArg;
  }
}

export async function proxyInternalGet<T>(options: ProxyRequestOptions): Promise<T> {
  const { apiBaseOrigin, internalSecret, proxyTimeoutMs } = getServerConfig();
  const url = new URL(options.path, apiBaseOrigin);
  if (options.searchParams) {
    options.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  if (requiresBackofficeScopePath(options.path) && !options.backofficeScope) {
    throw new Error("Missing backofficeScope for internal RBAC proxy");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), proxyTimeoutMs);

  const headers: Record<string, string> = {
    "X-Internal-Secret": internalSecret,
  };
  const scope = options.backofficeScope;
  if (scope?.role === "admin") {
    headers["X-Backoffice-Role"] = "admin";
  } else if (scope?.role === "merchant") {
    headers["X-Backoffice-Role"] = "merchant";
    headers["X-Backoffice-Merchant-Id"] = scope.merchantId;
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      headers,
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
    const { text, truncated, measuredBodyBytes } = await readResponseTextWithByteLimit(
      response,
      PROXY_UPSTREAM_BODY_READ_MAX_BYTES,
    );
    throw new ProxyUpstreamError(response.status, text, truncated, measuredBodyBytes);
  }

  return (await response.json()) as T;
}

export async function proxyInternalPost<T>(options: ProxyWriteOptions): Promise<T> {
  const { apiBaseOrigin, internalSecret, proxyTimeoutMs } = getServerConfig();
  const url = new URL(options.path, apiBaseOrigin);
  if (options.searchParams) {
    options.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  if (requiresBackofficeScopePath(options.path) && !options.backofficeScope) {
    throw new Error("Missing backofficeScope for internal RBAC proxy");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), proxyTimeoutMs);

  const headers: Record<string, string> = {
    "X-Internal-Secret": internalSecret,
    "Content-Type": "application/json",
  };
  const scope = options.backofficeScope;
  if (scope?.role === "admin") {
    headers["X-Backoffice-Role"] = "admin";
  } else if (scope?.role === "merchant") {
    headers["X-Backoffice-Role"] = "merchant";
    headers["X-Backoffice-Merchant-Id"] = scope.merchantId;
  }

  const bodyPayload =
    options.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      redirect: "manual",
      headers,
      body: bodyPayload,
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
    const { text, truncated, measuredBodyBytes } = await readResponseTextWithByteLimit(
      response,
      PROXY_UPSTREAM_BODY_READ_MAX_BYTES,
    );
    throw new ProxyUpstreamError(response.status, text, truncated, measuredBodyBytes);
  }

  return (await response.json()) as T;
}

export async function proxyInternalPatch<T>(options: ProxyWriteOptions): Promise<T> {
  const { apiBaseOrigin, internalSecret, proxyTimeoutMs } = getServerConfig();
  const url = new URL(options.path, apiBaseOrigin);
  if (options.searchParams) {
    options.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  if (requiresBackofficeScopePath(options.path) && !options.backofficeScope) {
    throw new Error("Missing backofficeScope for internal RBAC proxy");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), proxyTimeoutMs);

  const headers: Record<string, string> = {
    "X-Internal-Secret": internalSecret,
    "Content-Type": "application/json",
  };
  const scope = options.backofficeScope;
  if (scope?.role === "admin") {
    headers["X-Backoffice-Role"] = "admin";
  } else if (scope?.role === "merchant") {
    headers["X-Backoffice-Role"] = "merchant";
    headers["X-Backoffice-Merchant-Id"] = scope.merchantId;
  }

  const bodyPayload =
    options.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "PATCH",
      redirect: "manual",
      headers,
      body: bodyPayload,
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
    const { text, truncated, measuredBodyBytes } = await readResponseTextWithByteLimit(
      response,
      PROXY_UPSTREAM_BODY_READ_MAX_BYTES,
    );
    throw new ProxyUpstreamError(response.status, text, truncated, measuredBodyBytes);
  }

  return (await response.json()) as T;
}

export async function proxyPublicGet<T>(options: ProxyRequestOptions): Promise<T> {
  const { apiBaseOrigin, proxyTimeoutMs } = getPublicServerConfig();
  const url = new URL(options.path, apiBaseOrigin);
  if (options.searchParams) {
    options.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), proxyTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "<missing>";
    throw new Error(
      `PSP API returned redirect (${response.status}) to "${location}". Redirects are not allowed for public proxy requests.`,
    );
  }

  if (!response.ok) {
    const { text, truncated, measuredBodyBytes } = await readResponseTextWithByteLimit(
      response,
      PROXY_UPSTREAM_BODY_READ_MAX_BYTES,
    );
    throw new ProxyUpstreamError(response.status, text, truncated, measuredBodyBytes);
  }

  return (await response.json()) as T;
}

export async function proxyPublicPost<T>(options: ProxyWriteOptions): Promise<T> {
  const { apiBaseOrigin, proxyTimeoutMs } = getPublicServerConfig();
  const url = new URL(options.path, apiBaseOrigin);
  if (options.searchParams) {
    options.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }

  const bodyPayload =
    options.body === undefined
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), proxyTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json" },
      body: bodyPayload,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "<missing>";
    throw new Error(
      `PSP API returned redirect (${response.status}) to "${location}". Redirects are not allowed for public proxy requests.`,
    );
  }

  if (!response.ok) {
    const { text, truncated, measuredBodyBytes } = await readResponseTextWithByteLimit(
      response,
      PROXY_UPSTREAM_BODY_READ_MAX_BYTES,
    );
    throw new ProxyUpstreamError(response.status, text, truncated, measuredBodyBytes);
  }

  return (await response.json()) as T;
}

function safeUpstreamClientMessage(status: number): string {
  if (status === 401 || status === 403) return "Forbidden";
  if (status === 404) return "Resource not found";
  if (status === 409) return "Request conflicts with current resource state";
  if (status === 429) return "Too many requests";
  return "Request rejected by upstream service";
}

export function mapProxyError(error: unknown): NextResponse {
  if (error instanceof ProxyUpstreamError) {
    console.error("backoffice_proxy_error", {
      kind: "ProxyUpstreamError",
      upstreamStatus: error.upstreamStatus,
      bodyByteLength: error.measuredBodyBytes,
      bodyTruncatedByReader: error.bodyTruncated,
      bodyPreview: sanitizeSingleLinePreview(error.bodyText, PROXY_UPSTREAM_LOG_PREVIEW_MAX_CHARS),
    });

    const { upstreamStatus } = error;

    if (upstreamStatus >= 400 && upstreamStatus < 500) {
      return NextResponse.json(
        { message: safeUpstreamClientMessage(upstreamStatus), upstreamStatus },
        { status: upstreamStatus },
      );
    }

    return NextResponse.json({ message: "Upstream service unavailable" }, { status: 502 });
  }

  console.error("backoffice_proxy_error", error);

  const err = error instanceof Error ? error : new Error(String(error));
  if (err.name === "AbortError") {
    return NextResponse.json({ message: "Upstream request timed out" }, { status: 504 });
  }

  return NextResponse.json({ message: "Upstream service unavailable" }, { status: 502 });
}
