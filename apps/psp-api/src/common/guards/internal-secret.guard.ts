import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

const UNAUTHORIZED_MESSAGE = 'Unauthorized';

@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const secret = req.headers['x-internal-secret'];
    const expected = this.config.get<string>('INTERNAL_API_SECRET');
    if (!expected || !secret) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(secret);
    const sameLength = expectedBuf.length === providedBuf.length;
    const isMatch =
      sameLength && timingSafeEqual(expectedBuf, providedBuf);
    if (!isMatch) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    return true;
  }
}
