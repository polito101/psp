import { ConflictException } from '@nestjs/common';
import { randomInt } from 'crypto';
import type { Prisma } from '../generated/prisma/client';

/** Nombre del índice único de Prisma para `Merchant.mid` (`@unique`). */
export const MERCHANT_MID_UNIQUE_CONSTRAINT = 'Merchant_mid_key';

const DEFAULT_MAX_ATTEMPTS = 25;

type PrismaKnownRequestLike = {
  code?: unknown;
  meta?: { target?: unknown; modelName?: unknown };
};

/**
 * P2002 de unicidad sobre `Merchant.mid` (colisión bajo concurrencia).
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

function generateMerchantMidCandidate(): string {
  return String(randomInt(100000, 1_000_000));
}

/**
 * Crea un merchant con un `mid` aleatorio de 6 dígitos, reintentando si el insert
 * choca por unicidad (`Merchant_mid_key`) — la única fuente de verdad bajo concurrencia.
 */
export async function createMerchantWithUniqueMid(
  tx: Prisma.TransactionClient,
  buildData: (mid: string) => Prisma.MerchantCreateInput,
  options?: { maxAttempts?: number },
): Promise<Awaited<ReturnType<Prisma.TransactionClient['merchant']['create']>>> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const mid = generateMerchantMidCandidate();
    try {
      return await tx.merchant.create({ data: buildData(mid) });
    } catch (error) {
      if (isMerchantMidUniqueViolation(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new ConflictException('Could not allocate merchant MID');
}
