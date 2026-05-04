import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnboardingEmailService } from './onboarding-email.service';

describe('OnboardingEmailService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('includes escaped portal credentials and onboarding link in the email body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: jest.fn().mockResolvedValue({ id: 'email_1' }),
    } as unknown as Response);

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return 'resend-key';
        if (key === 'ONBOARDING_EMAIL_FROM') return 'Finara <onboarding@example.com>';
        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new OnboardingEmailService(config);

    await service.sendOnboardingLink({
      to: 'merchant@example.com',
      contactName: 'Ada <Admin>',
      loginEmail: 'merchant@example.com',
      initialPassword: 'p&ss"<word>',
      onboardingUrl: 'https://example.com/onboarding/secret?next=<portal>',
    });

    const fetchBody = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body as string,
    ) as { html: string; text: string };
    expect(fetchBody.html).toContain('Hola Ada &lt;Admin&gt;');
    expect(fetchBody.html).toContain('merchant@example.com');
    expect(fetchBody.html).toContain('p&amp;ss&quot;&lt;word&gt;');
    expect(fetchBody.html).toContain(
      'href="https://example.com/onboarding/secret?next=&lt;portal&gt;"',
    );
    expect(fetchBody.text).toContain('Email: merchant@example.com');
    expect(fetchBody.text).toContain('Password: p&ss"<word>');
    expect(fetchBody.text).toContain(
      'Onboarding: https://example.com/onboarding/secret?next=<portal>',
    );
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
      loginEmail: 'merchant@example.com',
      initialPassword: 'initial_password',
      onboardingUrl: 'https://example.com/onboarding/secret',
    });

    expect(result).toEqual({ ok: false, errorMessage: 'Resend responded 500' });
    expect(text).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'merchant_onboarding.email_failed status=500 request_id=req_123',
    );
  });

  it('returns failure on Resend fetch timeout/abort (no hang)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const timeoutError =
      typeof DOMException !== 'undefined'
        ? new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        : Object.assign(new Error('The operation was aborted due to timeout'), {
            name: 'TimeoutError',
          });
    global.fetch = jest.fn().mockRejectedValue(timeoutError);

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
      loginEmail: 'merchant@example.com',
      initialPassword: 'initial_password',
      onboardingUrl: 'https://example.com/onboarding',
    });

    expect(result).toEqual({ ok: false, errorMessage: 'Resend request timed out' });
    expect(warnSpy).toHaveBeenCalledWith('merchant_onboarding.email_fetch_timeout');
  });

  it('returns failure on other fetch errors', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'RESEND_API_KEY') return 'resend-key';
        if (key === 'ONBOARDING_EMAIL_FROM') return 'Finara <onboarding@example.com>';
        return undefined;
      }),
    } as unknown as ConfigService;
    const service = new OnboardingEmailService(config);

    const result = await service.sendOnboardingDecisionEmail({
      to: 'm@example.com',
      contactName: 'Bob',
      decision: 'approved',
    });

    expect(result).toEqual({ ok: false, errorMessage: 'Resend request failed' });
    expect(warnSpy).toHaveBeenCalledWith('merchant_onboarding.email_fetch_failed');
  });
});
