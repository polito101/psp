import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnboardingEmailService } from './onboarding-email.service';

describe('OnboardingEmailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('does not read or log the Resend error response body', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const text = jest.fn().mockResolvedValue('token=https://example.com/onboarding/secret');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers({ 'x-request-id': 'req_123' }),
      text,
    } as unknown as Response);

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return 'resend-key';
        if (key === 'ONBOARDING_EMAIL_FROM') return 'Finara <onboarding@example.com>';
        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new OnboardingEmailService(config);

    const result = await service.sendOnboardingLink({
      to: 'merchant@example.com',
      contactName: 'Ada',
      onboardingUrl: 'https://example.com/onboarding/secret',
    });

    expect(result).toEqual({ ok: false, errorMessage: 'Resend responded 500' });
    expect(text).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'merchant_onboarding.email_failed status=500 request_id=req_123',
    );
  });
});
