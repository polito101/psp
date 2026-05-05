import { randomInt } from 'crypto';
import { Prisma } from '../generated/prisma/client';

/** Mensaje HTTP genérico (es) cuando MID allocation agota reintentos por colisiones. */
export const MERCHANT_MID_ALLOCATION_CONFLICT_MESSAGE =
  'No se pudo completar el registro en este momento. Vuelve a intentarlo.';

/** Mensaje HTTP genérico (es) cuando la secuencia MID no está operativa (sin detalles técnicos). */
export const MERCHANT_MID_ALLOCATION_UNAVAILABLE_MESSAGE =
  'El servicio no está disponible temporalmente. Inténtalo de nuevo en unos momentos.';

/**
 * Fallo al obtener o persistir un `mid` único; la capa HTTP traduce `retries_exhausted` → 409 y
 * `sequence_unavailable` → 503 (mensajes genéricos en español).
 */
export class MerchantMidAllocationFailedError extends Error {
  override readonly name = 'MerchantMidAllocationFailedError';

  /** Preservado cuando el fallo envuelve un error subyacente (p. ej. `nextval` en DB). */
  readonly cause?: unknown;

  constructor(
    readonly reason: 'retries_exhausted' | 'sequence_unavailable',
    options?: { cause?: unknown },
  ) {
    super(
      reason === 'sequence_unavailable'
        ? 'Merchant MID sequence returned no value'
        : 'Merchant MID allocation retries exhausted',
    );
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Nombre del índice único de Prisma para `Merchant.mid` (`@unique`). */
export const MERCHANT_MID_UNIQUE_CONSTRAINT = 'Merchant_mid_key';

/** Nombre del objeto SEQUENCE en Postgres (schema `public` por defecto). */
export const MERCHANT_MID_SEQUENCE = 'merchant_mid_seq';

/** Reintentos defensivos (p.ej. `mid` heredado/manual fuera del rango de la secuencia). */
const DEFAULT_MAX_ATTEMPTS = 12;

type PrismaKnownRequestLike = {
  code?: unknown;
  meta?: { target?: unknown; modelName?: unknown };
};

/**
 * P2002 de unicidad sobre `Merchant.mid` (colisión con fila existente, p. ej. datos legacy).
 */
export function isMerchantMidUniqueViolation(error: unknown): boolean {
  const err = error as PrismaKnownRequestLike;
  if (typeof err.code !== 'string' || err.code !== 'P2002') {
    return false;
  }
  const meta = err.meta;
  const rawTarget = meta?.target;
  const targetParts: string[] = Array.isArray(rawTarget)
    ? rawTarget.filter((t): t is string => typeof t === 'string')
    : typeof rawTarget === 'string'
      ? [rawTarget]
      : [];

  const hitsMid = targetParts.some(
    (t) => t === 'mid' || t === MERCHANT_MID_UNIQUE_CONSTRAINT,
  );
  if (!hitsMid) {
    return false;
  }

  const modelName = meta?.modelName;
  if (typeof modelName === 'string' && modelName !== 'Merchant') {
    return false;
  }
  return true;
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Dispersión breve ante colisiones muy raras (secuencia + datos legacy). */
async function backoffBeforeMidCollisionRetry(collisionAttempt: number): Promise<void> {
  if (collisionAttempt < 1) {
    return;
  }
  const capMs = 60;
  const base = Math.min(capMs, 8 + collisionAttempt * 10);
  const jitterMs = randomInt(0, 17);
  await sleepMs(base + jitterMs);
}

/** Códigos Postgres habitualmente no atribuibles a “colisión” / flujo esperado de MID. */
const PG_INFRA_ERROR_CODE_PREFIXES = ['08', '53', '57', '3D', '3F'] as const;

const PG_INFRA_ERROR_CODES = new Set<string>([
  '42P01', // undefined_table / sequence relation missing
  '42501', // insufficient_privilege
]);

/** Códigos Prisma de conectividad / pool (ver docs `reference/api-reference/error-reference`). */
const PRISMA_INFRA_ERROR_CODES = new Set<string>([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
]);

function pushCodesFromError(error: unknown, out: Set<string>, depth: number): void {
  if (error == null || depth > 6) {
    return;
  }
  const e = error as Record<string, unknown>;
  if (typeof e.code === 'string') {
    out.add(e.code);
  }
  const meta = e.meta;
  if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    if (typeof m.code === 'string') {
      out.add(m.code);
    }
  }
  if (e.cause !== undefined) {
    pushCodesFromError(e.cause, out, depth + 1);
  }
}

/**
 * Indica si el fallo de `nextval` parece infra / migración / permisos / red, y debe propagarse
 * sin envolver como `MerchantMidAllocationFailedError('sequence_unavailable')`.
 */
export function isMidSequenceRawQueryInfrastructureError(error: unknown): boolean {
  const codes = new Set<string>();
  pushCodesFromError(error, codes, 0);

  for (const code of codes) {
    if (PRISMA_INFRA_ERROR_CODES.has(code)) {
      return true;
    }
    if (PG_INFRA_ERROR_CODES.has(code)) {
      return true;
    }
    if (code.length === 5 && PG_INFRA_ERROR_CODE_PREFIXES.some((p) => code.startsWith(p))) {
      return true;
    }
  }

  const e = error as Record<string, unknown>;
  const errno = e.errno;
  if (typeof errno === 'string' || typeof errno === 'number') {
    const networkish = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']);
    if (networkish.has(String(errno))) {
      return true;
    }
  }
  if (typeof e.code === 'string') {
    const networkish = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']);
    if (networkish.has(e.code)) {
      return true;
    }
  }

  return false;
}

async function allocateNextMerchantMidFromSequence(tx: Prisma.TransactionClient): Promise<string> {
  const regclass = `'${MERCHANT_MID_SEQUENCE}'::regclass`;
  let rows: Array<{ seq: bigint }>;
  try {
    rows = await tx.$queryRaw<Array<{ seq: bigint }>>(
      Prisma.sql`SELECT nextval(${Prisma.raw(regclass)}) AS seq`,
    );
  } catch (error) {
    if (isMidSequenceRawQueryInfrastructureError(error)) {
      throw error;
    }
    throw new MerchantMidAllocationFailedError('sequence_unavailable', { cause: error });
  }

  const seq = rows[0]?.seq;
  if (seq == null) {
    throw new MerchantMidAllocationFailedError('sequence_unavailable');
  }
  return seq.toString();
}

/**
 * Crea un merchant con `mid` numérico desde la secuencia Postgres (`merchant_mid_seq`).
 * Solo reintenta ante P2002 de `mid` (datos fuera del flujo esperado): jitter breve entre intentos.
 */
export async function createMerchantWithUniqueMid(
  tx: Prisma.TransactionClient,
  buildData: (mid: string) => Prisma.MerchantCreateInput,
  options?: { maxAttempts?: number },
): Promise<Awaited<ReturnType<Prisma.TransactionClient['merchant']['create']>>> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let midCollisionsSeen = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const mid = await allocateNextMerchantMidFromSequence(tx);

    try {
      return await tx.merchant.create({ data: buildData(mid) });
    } catch (error) {
      if (isMerchantMidUniqueViolation(error)) {
        midCollisionsSeen += 1;
        await backoffBeforeMidCollisionRetry(midCollisionsSeen);
        continue;
      }
      throw error;
    }
  }
  throw new MerchantMidAllocationFailedError('retries_exhausted');
}
