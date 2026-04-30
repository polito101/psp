import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendOnboardingEmailInput = {
  to: string;
  contactName: string;
  onboardingUrl: string;
};

export type SendOnboardingEmailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorMessage: string };

@Injectable()
export class OnboardingEmailService {
  private readonly logger = new Logger(OnboardingEmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOnboardingLink(
    input: SendOnboardingEmailInput,
  ): Promise<SendOnboardingEmailResult> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from = this.config.get<string>('ONBOARDING_EMAIL_FROM')?.trim();

    if (!apiKey || !from) {
      this.logger.warn('merchant_onboarding.email_not_configured');
      return { ok: false, errorMessage: 'Resend is not configured' };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: 'Completa tu onboarding en Finara',
        html:
          `<p>Hola ${escapeHtml(input.contactName)},</p>` +
          '<p>Completa los datos de tu negocio para iniciar la revisión:</p>' +
          `<p><a href="${escapeHtml(input.onboardingUrl)}">Abrir onboarding</a></p>`,
        text: `Hola ${input.contactName}, completa los datos de tu negocio en: ${input.onboardingUrl}`,
      }),
    });

    if (!response.ok) {
      const preview = (await response.text()).slice(0, 200);
      this.logger.warn(
        `merchant_onboarding.email_failed status=${response.status} body=${preview}`,
      );
      return { ok: false, errorMessage: `Resend responded ${response.status}` };
    }

    const payload: unknown = await response.json().catch(() => null);
    const providerMessageId =
      isObjectWithStringId(payload) ? payload.id : null;

    return { ok: true, providerMessageId };
  }
}

function isObjectWithStringId(value: unknown): value is { id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
