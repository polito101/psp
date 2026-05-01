import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnboardingEmailService } from './onboarding-email.service';

describe('OnboardingEmailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
    const map: Record<string, string | undefined> = {
      RESEND_API_KEY: 're_test_key',
      ONBOARDING_EMAIL_FROM: 'onboarding@example.com',
      ONBOARDING_EMAIL_RESEND_FETCH_TIMEOUT_MS: '10000',
      ...overrides,
    };
    return {
      get: (k: string) => map[k],
    } as ConfigService;
  }

  it('returns { ok: false } when fetch rejects (e.g. ECONNRESET)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const svc = new OnboardingEmailService(makeConfig());
    const r = await svc.sendOnboardingLink({
      to: 'merchant@test.com',
      contactName: 'María',
      onboardingUrl: 'https://backoffice.example/onboarding/token',
    });

    expect(r).toEqual({ ok: false, errorMessage: 'Resend request failed' });
    expect(global.fetch).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'merchant_onboarding.resend_fetch_failed',
        error: 'ECONNRESET',
      }),
    );

    warn.mockRestore();
  });

  it('returns ok true with provider id on HTTP 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg_123' }),
    });

    const svc = new OnboardingEmailService(makeConfig());
    const r = await svc.sendOnboardingLink({
      to: 'merchant@test.com',
      contactName: 'Test',
      onboardingUrl: 'https://example.com/o/t',
    });

    expect(r).toEqual({ ok: true, providerMessageId: 'msg_123' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns { ok: false } when Resend is not configured', async () => {
    const svc = new OnboardingEmailService(
      makeConfig({ RESEND_API_KEY: '', ONBOARDING_EMAIL_FROM: 'x@y.com' }),
    );
    const r = await svc.sendOnboardingLink({
      to: 'a@b.com',
      contactName: 'X',
      onboardingUrl: 'https://x',
    });
    expect(r).toEqual({ ok: false, errorMessage: 'Resend is not configured' });
  });
});
