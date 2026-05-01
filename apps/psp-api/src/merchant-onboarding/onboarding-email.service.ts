import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const RESEND_API_URL = 'https://api.resend.com/emails';

/** Valor por defecto si `ConfigService` no expone la clave (p. ej. tests aislados). */
const DEFAULT_RESEND_FETCH_TIMEOUT_MS = 10_000;

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

  /**
   * Envía el enlace de onboarding vía API de Resend.
   * Errores de red, timeouts y aborts se convierten en `{ ok: false }` sin propagar excepciones.
   */
  async sendOnboardingLink(input: SendOnboardingEmailInput): Promise<SendOnboardingEmailResult> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from = this.config.get<string>('ONBOARDING_EMAIL_FROM')?.trim();

    if (!apiKey || !from) {
      this.logger.warn('merchant_onboarding.email_not_configured');
      return { ok: false, errorMessage: 'Resend is not configured' };
    }

    const timeoutRaw = this.config.get<string>('ONBOARDING_EMAIL_RESEND_FETCH_TIMEOUT_MS');
    const timeoutMs = Number(timeoutRaw);
    const signalMs =
      Number.isInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 120_000
        ? timeoutMs
        : DEFAULT_RESEND_FETCH_TIMEOUT_MS;

    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: 'Completa tu onboarding en Finara',
          html: `<p>Hola ${escapeHtml(input.contactName)},</p><p>Completa los datos de tu negocio para iniciar la revisión:</p><p><a href="${escapeHtml(input.onboardingUrl)}">Abrir onboarding</a></p>`,
          text: `Hola ${input.contactName}, completa los datos de tu negocio en: ${input.onboardingUrl}`,
        }),
        signal: AbortSignal.timeout(signalMs),
      });

      if (!response.ok) {
        const preview = (await response.text()).slice(0, 200);
        this.logger.warn(`merchant_onboarding.email_failed status=${response.status} body=${preview}`);
        return { ok: false, errorMessage: `Resend responded ${response.status}` };
      }

      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      return { ok: true, providerMessageId: payload?.id ?? null };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        JSON.stringify({
          event: 'merchant_onboarding.resend_fetch_failed',
          error,
        }),
      );
      return { ok: false, errorMessage: 'Resend request failed' };
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
