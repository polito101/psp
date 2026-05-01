import { OnboardingTokenService } from './onboarding-token.service';

describe('OnboardingTokenService', () => {
  const service = new OnboardingTokenService();

  it('generates opaque tokens and sha256 hashes', () => {
    const first = service.generatePlainToken();
    const second = service.generatePlainToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(first).not.toBe(second);
    expect(service.hashToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hashToken(first)).toBe(service.hashToken(first));
  });

  it('computes expiry from configured ttl hours', () => {
    const now = new Date('2026-04-30T12:00:00.000Z');
    expect(service.computeExpiresAt(24, now).toISOString()).toBe(
      '2026-05-01T12:00:00.000Z',
    );
  });
});
