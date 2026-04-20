/** Cookie HttpOnly con JWT de sesión del backoffice (admin o merchant).
 *
 * Vive en un módulo sin dependencias de `node:crypto` para poder ser
 * importado por `middleware.ts` (Edge runtime) sin arrastrar APIs de Node.
 */
export const BACKOFFICE_SESSION_COOKIE_NAME = "backoffice_session";
