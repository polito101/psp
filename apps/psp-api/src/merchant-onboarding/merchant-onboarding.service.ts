import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MerchantsService } from '../merchants/merchants.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MerchantOnboardingActorType,
  MerchantOnboardingStatus,
} from '../generated/prisma/enums';
import { CreateMerchantOnboardingApplicationDto } from './dto/create-merchant-onboarding-application.dto';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';

const CHECKLIST_ITEMS = [
  { key: 'basic_contact_created', label: 'Contacto inicial creado' },
  { key: 'business_profile_submitted', label: 'Datos de negocio enviados' },
  { key: 'internal_review', label: 'Revisión interna' },
  { key: 'approval_decision', label: 'Decisión de aprobación' },
  { key: 'merchant_activation', label: 'Merchant activado' },
] as const;

/** Respuesta pública idéntica para éxito o email duplicado (no filtra estado interno). */
export type PublicCreateApplicationResponse = {
  ok: true;
  /** Solo en entornos no productivos cuando aplica. */
  onboardingUrl?: string;
};

function normalizeOnboardingEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isContactEmailUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ((error as { code?: string }).code !== 'P2002') {
    return false;
  }
  const meta = (error as { meta?: { target?: unknown; modelName?: string } }).meta;
  const target = meta?.target;
  if (!Array.isArray(target)) {
    return false;
  }
  const hitsEmailField = target.some((t) => t === 'contact_email' || t === 'contactEmail');
  if (!hitsEmailField) {
    return false;
  }
  if (meta?.modelName !== undefined && meta.modelName !== 'MerchantOnboardingApplication') {
    return false;
  }
  return true;
}

function shouldExposeOnboardingUrl(config: ConfigService): boolean {
  const n = config.get<string>('NODE_ENV')?.toLowerCase();
  return n === 'development' || n === 'test' || n === 'sandbox';
}

@Injectable()
export class MerchantOnboardingService {
  private readonly log = new Logger(MerchantOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantsService,
    private readonly email: OnboardingEmailService,
    private readonly tokens: OnboardingTokenService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Respuesta neutral para el cliente público (éxito o colisión de email en DB).
   */
  publicCreateResponse(partial?: { onboardingUrl?: string }): PublicCreateApplicationResponse {
    const onboardingUrl = partial?.onboardingUrl;
    if (onboardingUrl && onboardingUrl.length > 0) {
      return { ok: true, onboardingUrl };
    }
    return { ok: true };
  }

  /**
   * Alta pública: transacción atómica merchant + expediente + token.
   * Unicidad de `contact_email` en DB evita duplicados concurrentes; P2002 → `publicCreateResponse()`.
   */
  async createApplication(dto: CreateMerchantOnboardingApplicationDto): Promise<PublicCreateApplicationResponse> {
    const contactEmail = normalizeOnboardingEmail(dto.email);

    const plainToken = this.tokens.generatePlainToken();
    const tokenHash = this.tokens.hashToken(plainToken);
    const ttlHoursRaw = this.config.get<string>('MERCHANT_ONBOARDING_TOKEN_TTL_HOURS');
    const ttlHoursParsed = ttlHoursRaw ? Number(ttlHoursRaw) : 168;
    const ttlHours =
      Number.isFinite(ttlHoursParsed) && ttlHoursParsed >= 1 && ttlHoursParsed <= 24 * 30
        ? ttlHoursParsed
        : 168;
    const expiresAt = this.tokens.computeExpiresAt(ttlHours);

    try {
      await this.prisma.$transaction(async (tx) => {
        const { id: merchantId } = await this.merchants.createInactiveShellForOnboarding(tx, dto.name);

        const application = await tx.merchantOnboardingApplication.create({
          data: {
            merchantId,
            status: MerchantOnboardingStatus.DOCUMENTATION_PENDING,
            contactName: dto.name,
            contactEmail,
            contactPhone: dto.phone,
          },
        });

        await tx.merchantOnboardingChecklistItem.createMany({
          data: CHECKLIST_ITEMS.map((item) => ({
            applicationId: application.id,
            key: item.key,
            label: item.label,
          })),
        });

        await tx.merchantOnboardingEvent.create({
          data: {
            applicationId: application.id,
            type: 'application_created',
            actorType: MerchantOnboardingActorType.SYSTEM,
            message: 'Solicitud de onboarding creada',
          },
        });

        await tx.merchantOnboardingToken.create({
          data: {
            applicationId: application.id,
            tokenHash,
            expiresAt,
          },
        });

        await tx.merchantOnboardingEvent.create({
          data: {
            applicationId: application.id,
            type: 'onboarding_link_issued',
            actorType: MerchantOnboardingActorType.SYSTEM,
            message: 'Enlace de onboarding generado',
          },
        });
      });
    } catch (error) {
      if (isContactEmailUniqueViolation(error)) {
        this.log.debug('merchant_onboarding.create_application.duplicate_contact_email');
        return this.publicCreateResponse();
      }
      throw error;
    }

    const baseUrl = (this.config.get<string>('MERCHANT_ONBOARDING_BASE_URL') ?? 'http://localhost:3005').replace(
      /\/$/,
      '',
    );
    const onboardingUrl = `${baseUrl}/onboarding/${encodeURIComponent(plainToken)}`;

    await this.email.sendOnboardingLink({
      to: contactEmail,
      contactName: dto.name,
      onboardingUrl,
    });

    if (shouldExposeOnboardingUrl(this.config)) {
      return this.publicCreateResponse({ onboardingUrl });
    }
    return this.publicCreateResponse();
  }
}
