/** URL de login merchant usada si falta env o la env es inválida (mismo default que Render blueprint). */
const DEFAULT_MERCHANT_BACKOFFICE_LOGIN =
  "https://psp-backoffice.onrender.com/login";

let warnedInvalidMerchantBackofficeUrl = false;

/**
 * Valor seguro para logs: nunca incluye userinfo. Si `URL` falla, redacta `scheme://user:pass@`.
 */
function sanitizeMerchantBackofficeUrlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return raw.replace(/^(https?:\/\/)[^/?#@]*@/i, "$1***@");
  }
}

function warnInvalidMerchantBackofficeUrlOnce(message: string): void {
  if (warnedInvalidMerchantBackofficeUrl) {
    return;
  }
  warnedInvalidMerchantBackofficeUrl = true;
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(`[web-finara] ${message}`);
  }
}

/**
 * Resuelve la URL del login del portal merchant (CTAs marketing).
 * Valida `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL`: URL absoluta, solo `https:`, sin credenciales en userinfo;
 * normaliza el path a `/login` sobre el mismo origin.
 * Si no cumple, usa el fallback oficial y emite un único `console.warn` por proceso (build/SSR/runtime).
 */
export function getMerchantBackofficeLoginUrl(): string {
  const raw = process.env.NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL;

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_MERCHANT_BACKOFFICE_LOGIN;
  }

  const trimmed = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    warnInvalidMerchantBackofficeUrlOnce(
      `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL is not a valid absolute URL (${sanitizeMerchantBackofficeUrlForLog(trimmed)}). Using default merchant login URL.`,
    );
    return DEFAULT_MERCHANT_BACKOFFICE_LOGIN;
  }

  if (parsed.protocol !== "https:") {
    warnInvalidMerchantBackofficeUrlOnce(
      `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL must use https (${parsed.origin}). Using default merchant login URL.`,
    );
    return DEFAULT_MERCHANT_BACKOFFICE_LOGIN;
  }

  if (parsed.username !== "" || parsed.password !== "") {
    warnInvalidMerchantBackofficeUrlOnce(
      `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL must not include credentials (origin ${parsed.origin}). Using default merchant login URL.`,
    );
    return DEFAULT_MERCHANT_BACKOFFICE_LOGIN;
  }

  if (parsed.hostname === "") {
    warnInvalidMerchantBackofficeUrlOnce(
      `NEXT_PUBLIC_MERCHANT_BACKOFFICE_URL must include a hostname (${parsed.origin}). Using default merchant login URL.`,
    );
    return DEFAULT_MERCHANT_BACKOFFICE_LOGIN;
  }

  const normalized = new URL("/login", parsed.origin).href;
  return normalized;
}
