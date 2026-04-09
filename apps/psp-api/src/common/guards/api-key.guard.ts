import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

export const MERCHANT_KEY = 'merchant';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      [MERCHANT_KEY]?: { id: string; name: string };
    }>();
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Missing X-API-Key');
    }

    const parts = apiKey.split('.');
    if (parts.length !== 3 || parts[0] !== 'psp') {
      throw new UnauthorizedException('Invalid API key');
    }
    const merchantId = parts[1];
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, apiKeyHash: true },
    });
    if (!merchant) {
      throw new UnauthorizedException('Invalid API key');
    }
    const ok = await bcrypt.compare(apiKey, merchant.apiKeyHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid API key');
    }
    req[MERCHANT_KEY] = { id: merchant.id, name: merchant.name };
    return true;
  }
}
