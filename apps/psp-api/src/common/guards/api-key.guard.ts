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
    if (!merchant) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    if (merchant.apiKeyRevokedAt !== null) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }
    if (merchant.apiKeyExpiresAt !== null && merchant.apiKeyExpiresAt < new Date()) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    const ok = await bcrypt.compare(apiKey, merchant.apiKeyHash);
    if (!ok) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }
    req[MERCHANT_KEY] = { id: merchant.id };
    return true;
  }
}
