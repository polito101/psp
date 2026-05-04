import { ConflictException } from '@nestjs/common';
import { randomInt } from 'crypto';
import type { Prisma } from '../generated/prisma/client';

/**
 * Obtiene un `mid` único de 6 dígitos dentro de una transacción Prisma activa.
 * Usado al crear merchants desde varios flujos (bootstrap, onboarding, shells).
 */
export async function allocateUniqueMerchantMid(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const mid = String(randomInt(100000, 1_000_000));
    const taken = await tx.merchant.findUnique({ where: { mid }, select: { id: true } });
    if (!taken) {
      return mid;
    }
  }
  throw new ConflictException('Could not allocate merchant MID');
}
