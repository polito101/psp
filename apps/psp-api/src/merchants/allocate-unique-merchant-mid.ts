import { randomInt } from 'crypto';
import { Prisma } from '../generated/prisma/client';

/**
 * Fallo al obtener o persistir un `mid` único; la capa HTTP debe traducirlo (p. ej. 409 genérico).
 */
export class MerchantMidAllocationFailedError extends Error {
  override readonly name = 'MerchantMidAllocationFailedError';

  constructor(readonly reason: 'retries_exhausted' | 'sequence_unavailable') {
    super(
      reason === 'sequence_unavailable'
        ? 'Merchant MID sequence returned no value'
        : 'Merchant MID allocation retries exhausted',
    );
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

async function allocateNextMerchantMidFromSequence(tx: Prisma.TransactionClient): Promise<string> {
  const regclass = `'${MERCHANT_MID_SEQUENCE}'::regclass`;
  const rows = await tx.$queryRaw<Array<{ seq: bigint }>>(
    Prisma.sql`SELECT nextval(${Prisma.raw(regclass)}) AS seq`,
  );

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
