/**
 * Modo del deploy (`merchant` portal vs `admin` portal).
 * Usa `BACKOFFICE_PORTAL_MODE` cuando está definido; si no, usa `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE`
 * para que Middleware/Edge conserve el comportamiento esperado cuando el bundle inyecta env públicos.
 *
 * Si ambas variables están fijadas a `admin` o `merchant` y difieren, el cliente y el servidor
 * desalinearían rutas de login y `POST /api/auth/session`; se lanza {@link BackofficePortalModeMisconfiguredError}.
 */

export type BackofficePortalMode = "merchant" | "admin";

export type PortalLoginPath = "/login" | "/admin/login";

/** Lanzada cuando `BACKOFFICE_PORTAL_MODE` y `NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE` son ambos `admin`|`merchant` y no coinciden. */
export class BackofficePortalModeMisconfiguredError extends Error {
  override readonly name = "BackofficePortalModeMisconfiguredError";

  constructor(
    public readonly serverEnvMode: BackofficePortalMode,
    public readonly publicEnvMode: BackofficePortalMode,
  ) {
    super(
      `BACKOFFICE_PORTAL_MODE (${serverEnvMode}) and NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE (${publicEnvMode}) must match when both are set.`,
    );
  }
}

function parseStrictPortalMode(value: string | undefined): BackofficePortalMode | undefined {
  if (value === "admin") return "admin";
  if (value === "merchant") return "merchant";
  return undefined;
}

export function getBackofficePortalMode(): BackofficePortalMode {
  const explicitParsed = parseStrictPortalMode(process.env.BACKOFFICE_PORTAL_MODE);
  const pubParsed = parseStrictPortalMode(process.env.NEXT_PUBLIC_BACKOFFICE_PORTAL_MODE);

  if (
    explicitParsed !== undefined &&
    pubParsed !== undefined &&
    explicitParsed !== pubParsed
  ) {
    throw new BackofficePortalModeMisconfiguredError(explicitParsed, pubParsed);
  }

  if (explicitParsed !== undefined) return explicitParsed;
  if (pubParsed !== undefined) return pubParsed;
  return "merchant";
}

export function getPortalLoginPath(mode: BackofficePortalMode = getBackofficePortalMode()): PortalLoginPath {
  return mode === "admin" ? "/admin/login" : "/login";
}

export function sessionRoleMatchesPortal(mode: BackofficePortalMode, role: "admin" | "merchant"): boolean {
  return mode === "admin" ? role === "admin" : role === "merchant";
}
