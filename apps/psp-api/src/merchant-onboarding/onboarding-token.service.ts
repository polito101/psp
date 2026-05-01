import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class OnboardingTokenService {
  generatePlainToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  computeExpiresAt(ttlHours: number, now = new Date()): Date {
    return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  }
}
