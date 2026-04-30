/**
 * Modo portal en cliente (solo `NEXT_PUBLIC_*`). Debe estar alineado con `BACKOFFICE_PORTAL_MODE` en deploy.
 */

export type ClientBackofficePortalMode = "merchant" | "admin";
export type ClientPortalLoginPath = "/login" | "/admin/login";

export function getClientBackofficePortalMode(): ClientBackofficePortalMode {
  return process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE === "admin" ? "admin" : "merchant";
}

export function getClientPortalLoginPath(): ClientPortalLoginPath {
  return getClientBackofficePortalMode() === "admin" ? "/admin/login" : "/login";
}
