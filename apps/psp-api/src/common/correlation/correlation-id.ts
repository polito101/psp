import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Cabecera de salida estándar (también aceptada en entrada). */
export const OUTGOING_CORRELATION_HEADER = 'X-Request-Id';

const MAX_LEN = 128;

function firstHeaderValue(headers: IncomingHttpHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name];
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === 'string' && first.trim().length > 0 ? first.trim() : undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Entrada: prioriza `X-Request-Id` sobre `X-Correlation-Id` si ambas existen.
 * Express expone nombres en minúsculas.
 */
export function readIncomingCorrelationId(headers: IncomingHttpHeaders | undefined): string | undefined {
  return firstHeaderValue(headers, 'x-request-id') ?? firstHeaderValue(headers, 'x-correlation-id');
}

/**
 * Valida cabecera entrante (ASCII imprimible, longitud acotada) o genera UUID v4.
 */
export function normalizeCorrelationIdOrGenerate(candidate: string | undefined): string {
  if (candidate === undefined) return randomUUID();
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LEN) return randomUUID();
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return randomUUID();
  return trimmed;
}
