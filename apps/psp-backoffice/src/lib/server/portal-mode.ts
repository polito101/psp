/**
 * Modo del deploy (`merchant` portal vs `admin` portal).
 * Usa `BACKOFFICE_PORTAL_MODE` cuando está definido; si no, usa `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE`
 * para que Middleware/Edge conserve el comportamiento esperado cuando el bundle inyecta env públicos.
 */

export type BackofficePortalMode = "merchant" | "admin";

export type PortalLoginPath = "/login" | "/admin/login";

export function getBackofficePortalMode(): BackofficePortalMode {
  const explicit = process.env.BACKOFFICE_PORTAL_MODE;
  if (explicit === "admin") return "admin";
  if (explicit === "merchant") return "merchant";
  const pub = process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE;
  if (pub === "admin") return "admin";
  return "merchant";
}

export function getPortalLoginPath(mode: BackofficePortalMode = getBackofficePortalMode()): PortalLoginPath {
  return mode === "admin" ? "/admin/login" : "/login";
}

export function sessionRoleMatchesPortal(mode: BackofficePortalMode, role: "admin" | "merchant"): boolean {
  return mode === "admin" ? role === "admin" : role === "merchant";
}
