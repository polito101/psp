import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

export const MERCHANT_KEY = 'merchant';
const UNAUTHORIZED_MESSAGE = 'Unauthorized';

/**
 * Hash precomputado de `'__psp_guard_timing_dummy__'` con coste bcrypt 12.
 *
 * Se usa cuando el merchant no existe para que `bcrypt.compare` se ejecute
 * igualmente y el tiempo de respuesta sea indistinguible del caso en que sí
 * existe, evitando inferencia por timing sobre la existencia de un merchantId.
 *
 * Usar un literal en lugar de `bcrypt.hashSync(...)` al nivel del módulo evita
 * bloquear el event loop ~300 ms en cada arranque del proceso.
 *
 * Para regenerar (offline):
 *   node -e "const b=require('bcryptjs'); console.log(b.hashSync('__psp_guard_timing_dummy__',12))"
 */
const DUMMY_HASH =
  '$2b$12$mNdNhOlp1G8aJ3nwPInclOPq9ClQCn/Lxt0XHVeaXiy0Kq1D3A5WW';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      [MERCHANT_KEY]?: { id: string };
    }>();
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    const parts = apiKey.split('.');
    if (parts.length !== 3 || parts[0] !== 'psp') {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }
    const merchantId = parts[1];
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        apiKeyHash: true,
        apiKeyRevokedAt: true,
        apiKeyExpiresAt: true,
      },
    });

    // Siempre ejecutar bcrypt.compare antes de cualquier throw por estado del merchant.
    // Si no hay merchant, comparar contra DUMMY_HASH para igualar el coste de bcrypt
    // en todas las rutas de rechazo y evitar inferencia de existencia por timing.
    const hashToCheck = merchant?.apiKeyHash ?? DUMMY_HASH;
    const hashOk = await bcrypt.compare(apiKey, hashToCheck);

    const now = new Date();
    const isRevoked = merchant?.apiKeyRevokedAt !== null && merchant?.apiKeyRevokedAt !== undefined;
    const isExpired =
      merchant?.apiKeyExpiresAt !== null &&
      merchant?.apiKeyExpiresAt !== undefined &&
      merchant.apiKeyExpiresAt < now;

    if (!merchant || !hashOk || isRevoked || isExpired) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    req[MERCHANT_KEY] = { id: merchant.id };
    return true;
  }
}
