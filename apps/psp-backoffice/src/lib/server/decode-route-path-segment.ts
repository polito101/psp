/**
 * Resultado de decodificar un segmento de ruta dinámica (`[param]`) con `decodeURIComponent`.
 * Percent-encoding inválido lanza `URIError` en JS; aquí se captura para responder **400** en BFF.
 */
export type DecodeRoutePathSegmentResult =
  | { ok: true; value: string }
  | { ok: false };

/**
 * Decodifica un segmento de path de App Router. Usar antes del `try/catch` del proxy
 * para no convertir `URIError` en **500**.
 */
export function tryDecodeRoutePathSegment(raw: string): DecodeRoutePathSegmentResult {
  try {
    return { ok: true, value: decodeURIComponent(raw) };
  } catch {
    return { ok: false };
  }
}
