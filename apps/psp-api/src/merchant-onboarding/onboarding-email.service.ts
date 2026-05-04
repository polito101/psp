import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SendOnboardingEmailInput = {
  to: string;
  contactName: string;
  onboardingUrl: string;
};

export type SendOnboardingDecisionEmailInput = {
  to: string;
  contactName: string;
  decision: 'approved' | 'rejected';
  /** Obligatorio cuando `decision === 'rejected'` (validado en el servicio de dominio). */
  rejectionReason?: string;
};

export type SendOnboardingEmailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorMessage: string };

/** Tiempo máximo de espera al API de Resend (conexión + respuesta HTTP inicial). */
const RESEND_FETCH_TIMEOUT_MS = 8_000;

@Injectable()
export class OnboardingEmailService {
  private readonly logger = new Logger(OnboardingEmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendOnboardingLink(
    input: SendOnboardingEmailInput,
  ): Promise<SendOnboardingEmailResult> {
    return this.sendViaResend({
      to: input.to,
      subject: 'Completa tu onboarding en Finara',
      html:
        `<p>Hola ${escapeHtml(input.contactName)},</p>` +
        '<p>Completa los datos de tu negocio para iniciar la revisión:</p>' +
        `<p><a href="${escapeHtml(input.onboardingUrl)}">Abrir onboarding</a></p>`,
      text: `Hola ${input.contactName}, completa los datos de tu negocio en: ${input.onboardingUrl}`,
    });
  }

  /**
   * Notifica al contacto del expediente el resultado de la revisión (aprobación o rechazo con motivo).
   */
  async sendOnboardingDecisionEmail(
    input: SendOnboardingDecisionEmailInput,
  ): Promise<SendOnboardingEmailResult> {
    if (input.decision === 'approved') {
      return this.sendViaResend({
        to: input.to,
        subject: 'Tu solicitud de onboarding ha sido aprobada — Finara',
        html:
          `<p>Hola ${escapeHtml(input.contactName)},</p>` +
          '<p>Tu solicitud de onboarding ha sido <strong>aprobada</strong>. Tu cuenta merchant ya está activa y puedes operar con Finara.</p>' +
          '<p>Si tienes dudas, contacta con soporte.</p>',
        text:
          `Hola ${input.contactName},\n\n` +
          'Tu solicitud de onboarding ha sido aprobada. Tu cuenta merchant ya está activa.\n\n' +
          '— Finara',
      });
    }

    const reason = (input.rejectionReason ?? '').trim() || 'No se indicó un motivo detallado.';
    return this.sendViaResend({
      to: input.to,
      subject: 'Actualización sobre tu solicitud de onboarding — Finara',
      html:
        `<p>Hola ${escapeHtml(input.contactName)},</p>` +
        '<p>Lamentamos informarte que tu solicitud de onboarding ha sido <strong>rechazada</strong>.</p>' +
        '<p><strong>Motivo indicado por el equipo:</strong></p>' +
        `<p>${escapeHtml(reason).replaceAll('\n', '<br />')}</p>`,
      text:
        `Hola ${input.contactName},\n\n` +
        'Tu solicitud de onboarding ha sido rechazada.\n\n' +
        'Motivo indicado por el equipo:\n' +
        `${reason}\n\n` +
        '— Finara',
    });
  }

  private async sendViaResend(parts: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<SendOnboardingEmailResult> {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const from = this.config.get<string>('ONBOARDING_EMAIL_FROM')?.trim();

    if (!apiKey || !from) {
      this.logger.warn('merchant_onboarding.email_not_configured');
      return { ok: false, errorMessage: 'Resend is not configured' };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: parts.to,
          subject: parts.subject,
          html: parts.html,
          text: parts.text,
        }),
        signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const requestId = response.headers.get('x-request-id');
        const requestIdSuffix = requestId ? ` request_id=${requestId}` : '';
        this.logger.warn(`merchant_onboarding.email_failed status=${response.status}${requestIdSuffix}`);
        return { ok: false, errorMessage: `Resend responded ${response.status}` };
      }

      const payload: unknown = await response.json().catch(() => null);
      const providerMessageId =
        isObjectWithStringId(payload) ? payload.id : null;

      return { ok: true, providerMessageId };
    } catch (err: unknown) {
      if (isResendFetchTimeoutOrAbortError(err)) {
        this.logger.warn('merchant_onboarding.email_fetch_timeout');
        return { ok: false, errorMessage: 'Resend request timed out' };
      }
      this.logger.warn('merchant_onboarding.email_fetch_failed');
      return { ok: false, errorMessage: 'Resend request failed' };
    }
  }
}

/**
 * `fetch` con `AbortSignal.timeout` rechaza con `TimeoutError` (DOMException) o `AbortError`.
 */
function isResendFetchTimeoutOrAbortError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'TimeoutError' || error.name === 'AbortError';
  }
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
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
