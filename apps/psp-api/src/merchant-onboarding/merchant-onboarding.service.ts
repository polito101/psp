import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { encryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import {
  MerchantOnboardingActorType,
  MerchantOnboardingChecklistStatus,
  MerchantOnboardingStatus,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { CreateMerchantOnboardingApplicationDto } from './dto/create-merchant-onboarding-application.dto';
import {
  ListMerchantOnboardingApplicationsQueryDto,
  MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MAX_LENGTH,
  MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MIN_LENGTH,
} from './dto/list-merchant-onboarding-applications-query.dto';
import { RejectMerchantOnboardingDto } from './dto/reject-merchant-onboarding.dto';
import { SubmitBusinessProfileDto } from './dto/submit-business-profile.dto';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';

const CHECKLIST_ITEMS = [
  { key: 'basic_contact_created', label: 'Contacto inicial creado' },
  { key: 'business_profile_submitted', label: 'Datos de negocio enviados' },
  { key: 'internal_review', label: 'Revisión interna' },
  { key: 'approval_decision', label: 'Decisión de aprobación' },
  { key: 'merchant_activation', label: 'Merchant activado' },
] as const;

const PUBLIC_CREATE_MESSAGE =
  'If the email can receive onboarding links, we will send next steps shortly.';

const PUBLIC_RESEND_MESSAGE =
  'If the application can receive onboarding links, we will send next steps shortly.';

/** Índice único en DB (`20260501120000_merchant_onboarding_contact_email_unique`). */
const CONTACT_EMAIL_UNIQUE_INDEX_NAME = 'merchant_onboarding_applications_contact_email_key';

type PrismaKnownRequestLike = {
  code?: unknown;
  meta?: { target?: unknown; modelName?: unknown };
};

/**
 * P2002 de unicidad sobre el email de contacto del expediente (carrera tras `findFirst`).
 * Comprobación estructural (sin importar clases desde rutas internas de `@prisma/client`).
 */
function isContactEmailUniqueViolation(error: unknown): boolean {
  const err = error as PrismaKnownRequestLike;
  if (typeof err.code !== 'string' || err.code !== 'P2002') {
    return false;
  }
  const meta = err.meta;

  const rawTarget = meta?.target;
  const targetParts: string[] = Array.isArray(rawTarget)
    ? rawTarget.filter((t): t is string => typeof t === 'string')
    : typeof rawTarget === 'string'
      ? [rawTarget]
      : [];

  const hitsEmailConstraint = targetParts.some(
    (t) =>
      t === 'contact_email' ||
      t === 'contactEmail' ||
      t === CONTACT_EMAIL_UNIQUE_INDEX_NAME,
  );
  if (!hitsEmailConstraint) {
    return false;
  }

  const modelName = meta?.modelName;
  if (typeof modelName === 'string' && modelName !== 'MerchantOnboardingApplication') {
    return false;
  }
  return true;
}

type OnboardingTransaction = Prisma.TransactionClient;

/**
 * Namespace int4 dedicado para `pg_advisory_xact_lock` de creación pública por `contactEmail`
 * (evita colisiones con otros usos de advisory locks en el proceso).
 */
const ADVISORY_LOCK_MERCHANT_ONBOARDING_CONTACT_EMAIL_NS = 0x504d4f62;

type CreateApplicationTxResult =
  | { kind: 'created'; applicationId: string }
  | { kind: 'duplicate' };

/**
 * Deriva el par (int4, int4) para `pg_advisory_xact_lock` a partir del email normalizado.
 * Misma dirección siempre → misma clave; colisiones entre emails distintos solo serializan de más.
 */
function contactEmailOnboardingAdvisoryKeys(contactEmail: string): readonly [number, number] {
  const digest = createHash('sha256')
    .update('psp:v1:merchant_onboarding:create_application_by_contact_email\0')
    .update(contactEmail, 'utf8')
    .digest();
  return [ADVISORY_LOCK_MERCHANT_ONBOARDING_CONTACT_EMAIL_NS, digest.readInt32BE(0)] as const;
}

/**
 * Bloquea en exclusiva (hasta fin de transacción) la creación por este `contactEmail`.
 * Cubre la ventana entre migración (sin índice UNIQUE) y `prisma:ops:indexes`.
 */
async function acquireOnboardingContactEmailCreateLock(
  tx: OnboardingTransaction,
  contactEmail: string,
): Promise<void> {
  const [k1, k2] = contactEmailOnboardingAdvisoryKeys(contactEmail);
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${k1}::integer, ${k2}::integer)`);
}

type EmailDeliveryResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorMessage: string };
type MerchantSummary = {
  id: string;
  name: string;
  isActive: boolean;
  deactivatedAt?: Date | null;
  createdAt?: Date;
};
type ApplicationWithMerchant = {
  merchant?: MerchantSummary | null;
};

@Injectable()
export class MerchantOnboardingService {
  private readonly logger = new Logger(MerchantOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: OnboardingTokenService,
    private readonly emailService: OnboardingEmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea una solicitud pública de onboarding sin revelar si el email ya existe.
   * El merchant queda inactivo hasta que el backoffice apruebe la aplicación.
   *
   * Concurrencia: `pg_advisory_xact_lock` por email dentro de la transacción evita duplicados
   * mientras el UNIQUE de `contact_email` se crea fuera de la migración (`prisma:ops:indexes`).
   * Con índice ya aplicado, P2002 sigue siendo red de seguridad (misma respuesta neutral).
   */
  async createApplication(dto: CreateMerchantOnboardingApplicationDto) {
    const contactEmail = normalizeEmail(dto.email);
    // Atajo idempotente; bajo carrera la comprobación definitiva es tras advisory lock en la TX.
    const existing = await this.prisma.merchantOnboardingApplication.findFirst({
      where: { contactEmail },
      select: { id: true },
    });

    if (existing) {
      return this.publicCreateResponse();
    }

    const now = new Date();
    const token = await this.createTokenValues(now);
    const onboardingUrl = this.buildOnboardingUrl(token.plain);
    const webhookSecretPlain = `whsec_${randomBytes(24).toString('base64url')}`;
    const webhookSecretCiphertext = encryptUtf8(webhookSecretPlain);
    const placeholderHash = await bcrypt.hash(randomBytes(16).toString('hex'), 12);

    let txResult: CreateApplicationTxResult;
    try {
      txResult = await this.prisma.$transaction(async (tx): Promise<CreateApplicationTxResult> => {
        await acquireOnboardingContactEmailCreateLock(tx, contactEmail);

        const existingAfterLock = await tx.merchantOnboardingApplication.findFirst({
          where: { contactEmail },
          select: { id: true },
        });
        if (existingAfterLock) {
          return { kind: 'duplicate' };
        }

        const merchant = await tx.merchant.create({
          data: {
            name: dto.name,
            apiKeyHash: placeholderHash,
            webhookSecretCiphertext,
            isActive: false,
            deactivatedAt: now,
          },
        });

        const application = await tx.merchantOnboardingApplication.create({
          data: {
            merchantId: merchant.id,
            contactName: dto.name,
            contactEmail,
            contactPhone: dto.phone,
            status: MerchantOnboardingStatus.ACCOUNT_CREATED,
          },
        });

        await tx.merchantOnboardingChecklistItem.createMany({
          data: CHECKLIST_ITEMS.map((item) => ({
            applicationId: application.id,
            key: item.key,
            label: item.label,
            status:
              item.key === 'basic_contact_created'
                ? MerchantOnboardingChecklistStatus.COMPLETED
                : MerchantOnboardingChecklistStatus.PENDING,
            completedAt: item.key === 'basic_contact_created' ? now : null,
          })),
        });

        await tx.merchantOnboardingToken.create({
          data: {
            applicationId: application.id,
            tokenHash: token.hash,
            expiresAt: token.expiresAt,
          },
        });

        await tx.merchantOnboardingApplication.update({
          where: { id: application.id },
          data: { status: MerchantOnboardingStatus.DOCUMENTATION_PENDING },
        });

        await tx.merchantOnboardingEvent.create({
          data: {
            applicationId: application.id,
            type: 'APPLICATION_CREATED',
            actorType: MerchantOnboardingActorType.SYSTEM,
            message: 'Solicitud de onboarding creada.',
          },
        });

        await tx.merchantOnboardingEvent.create({
          data: {
            applicationId: application.id,
            type: 'ONBOARDING_LINK_SENT',
            actorType: MerchantOnboardingActorType.SYSTEM,
            message: 'Link de onboarding generado.',
          },
        });

        return { kind: 'created', applicationId: application.id };
      });
    } catch (error) {
      if (isContactEmailUniqueViolation(error)) {
        this.logger.debug('merchant_onboarding.create_application.duplicate_contact_email');
        return this.publicCreateResponse();
      }
      throw error;
    }

    if (txResult.kind === 'duplicate') {
      this.logger.debug('merchant_onboarding.create_application.duplicate_after_contact_email_lock');
      return this.publicCreateResponse();
    }

    const applicationId = txResult.applicationId;
    const emailResult = await this.sendOnboardingEmail({
      to: contactEmail,
      contactName: dto.name,
      onboardingUrl,
    });
    await this.recordEmailDeliveryEvent(applicationId, emailResult);

    return this.publicCreateResponse(onboardingUrl);
  }

  /**
   * Valida un token público y devuelve la fila asociada si sigue usable.
   */
  async validateToken(token: string) {
    const tokenHash = this.tokenService.hashToken(token);
    const row = await this.prisma.merchantOnboardingToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        applicationId: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        application: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!row || row.usedAt || row.revokedAt || row.expiresAt <= new Date()) {
      throw new BadRequestException('Invalid or expired onboarding token');
    }

    if (row.application.status !== MerchantOnboardingStatus.DOCUMENTATION_PENDING) {
      throw new BadRequestException('Onboarding token is not valid for this application');
    }

    return {
      id: row.id,
      applicationId: row.applicationId,
      expiresAt: row.expiresAt,
      application: row.application,
    };
  }

  /**
   * Guarda el perfil de negocio desde el enlace público y pasa la solicitud a revisión interna.
   */
  async submitBusinessProfile(token: string, dto: SubmitBusinessProfileDto) {
    const tokenRow = await this.validateToken(token);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const tokenClaim = await tx.merchantOnboardingToken.updateMany({
        where: {
          id: tokenRow.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (tokenClaim.count !== 1) {
        throw new BadRequestException('Invalid or expired onboarding token');
      }

      const application = await tx.merchantOnboardingApplication.update({
        where: { id: tokenRow.applicationId },
        data: {
          status: MerchantOnboardingStatus.IN_REVIEW,
          tradeName: dto.tradeName,
          legalName: dto.legalName,
          country: dto.country,
          website: dto.website ?? null,
          businessType: dto.businessType,
          submittedAt: now,
        },
      });

      await tx.merchantOnboardingChecklistItem.updateMany({
        where: { applicationId: tokenRow.applicationId, key: 'business_profile_submitted' },
        data: {
          status: MerchantOnboardingChecklistStatus.COMPLETED,
          completedAt: now,
        },
      });

      await tx.merchantOnboardingEvent.create({
        data: {
          applicationId: tokenRow.applicationId,
          type: 'BUSINESS_PROFILE_SUBMITTED',
          actorType: MerchantOnboardingActorType.MERCHANT,
          message: 'Datos de negocio enviados.',
        },
      });

      return application;
    });
  }

  /**
   * Listado ops CRM. Con `q`, evita `COUNT(*)` (costoso con `contains` en varios campos): pide hasta `pageSize+1`
   * filas y devuelve `total` exacto si hay ≤ `pageSize` coincidencias; si hay más, `total === pageSize + 1` (cota inferior).
   */
  async listApplications(query: ListMerchantOnboardingApplicationsQueryDto) {
    const pageSize = query.pageSize ?? 50;
    const q = query.q?.trim();
    if (q) {
      if (q.length > MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MAX_LENGTH) {
        throw new BadRequestException(
          `El texto de búsqueda no puede superar ${MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MAX_LENGTH} caracteres.`,
        );
      }
      if (q.length < MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MIN_LENGTH) {
        throw new BadRequestException(
          `El texto de búsqueda debe tener al menos ${MERCHANT_ONBOARDING_APPLICATION_LIST_Q_MIN_LENGTH} caracteres.`,
        );
      }
    }

    const where: Prisma.MerchantOnboardingApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(q
        ? {
            OR: [
              { contactName: { contains: q } },
              { contactEmail: { contains: q } },
              { tradeName: { contains: q } },
              { legalName: { contains: q } },
            ],
          }
        : {}),
    };

    const applicationListSelect = {
      id: true,
      merchantId: true,
      status: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      tradeName: true,
      legalName: true,
      country: true,
      website: true,
      businessType: true,
      rejectionReason: true,
      submittedAt: true,
      reviewedAt: true,
      approvedAt: true,
      rejectedAt: true,
      activatedAt: true,
      createdAt: true,
      updatedAt: true,
      merchant: {
        select: {
          id: true,
          name: true,
          isActive: true,
          deactivatedAt: true,
          createdAt: true,
        },
      },
      checklistItems: true,
    } satisfies Prisma.MerchantOnboardingApplicationSelect;

    const take = q ? pageSize + 1 : pageSize;
    const rows = await this.prisma.merchantOnboardingApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select: applicationListSelect,
    });

    if (q) {
      const hasMore = rows.length > pageSize;
      const items = rows.slice(0, pageSize).map(sanitizeApplicationMerchant);
      const total = hasMore ? pageSize + 1 : items.length;
      return { items, total, pageSize };
    }

    const total = await this.prisma.merchantOnboardingApplication.count({ where });
    return { items: rows.map(sanitizeApplicationMerchant), total, pageSize };
  }

  async getApplication(applicationId: string) {
    const application = await this.prisma.merchantOnboardingApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        merchantId: true,
        status: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        tradeName: true,
        legalName: true,
        country: true,
        website: true,
        businessType: true,
        rejectionReason: true,
        submittedAt: true,
        reviewedAt: true,
        approvedAt: true,
        rejectedAt: true,
        activatedAt: true,
        createdAt: true,
        updatedAt: true,
        merchant: {
          select: {
            id: true,
            name: true,
            isActive: true,
            deactivatedAt: true,
            createdAt: true,
          },
        },
        checklistItems: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!application) {
      throw new NotFoundException('Merchant onboarding application not found');
    }

    return sanitizeApplicationMerchant(application);
  }

  /**
   * Aprueba una solicitud y activa el merchant en una única transacción.
   * Tras el commit, notifica por email al contacto del expediente (mismo canal Resend que el link de onboarding).
   */
  async approveApplication(applicationId: string) {
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.merchantOnboardingApplication.updateMany({
        where: { id: applicationId, status: MerchantOnboardingStatus.IN_REVIEW },
        data: {
          status: MerchantOnboardingStatus.APPROVED,
          reviewedAt: now,
          approvedAt: now,
          rejectionReason: null,
        },
      });

      if (claim.count !== 1) {
        await this.throwDecisionClaimError(tx, applicationId);
      }

      const application = await this.findApplicationAfterClaim(tx, applicationId);

      await tx.merchantOnboardingChecklistItem.updateMany({
        where: {
          applicationId: application.id,
          key: { in: ['internal_review', 'approval_decision'] },
        },
        data: {
          status: MerchantOnboardingChecklistStatus.COMPLETED,
          completedAt: now,
        },
      });

      await this.createDecisionEvent(tx, application.id, 'application_approved', 'Solicitud aprobada.');

      await tx.merchant.update({
        where: { id: application.merchantId },
        data: { isActive: true, deactivatedAt: null },
      });

      const updated = await tx.merchantOnboardingApplication.update({
        where: { id: application.id },
        data: {
          status: MerchantOnboardingStatus.ACTIVE,
          activatedAt: now,
        },
      });

      await tx.merchantOnboardingChecklistItem.updateMany({
        where: { applicationId: application.id, key: 'merchant_activation' },
        data: {
          status: MerchantOnboardingChecklistStatus.COMPLETED,
          completedAt: now,
        },
      });

      await this.createDecisionEvent(tx, application.id, 'merchant_activated', 'Merchant activado.');

      return updated;
    });

    await this.notifyMerchantDecisionEmail(updated.id, {
      to: updated.contactEmail,
      contactName: updated.contactName,
      decision: 'approved',
    });

    return updated;
  }

  /**
   * Rechaza una solicitud sin activar el merchant asociado.
   * Tras el commit, notifica por email al contacto incluyendo el motivo de rechazo.
   */
  async rejectApplication(applicationId: string, dto: RejectMerchantOnboardingDto) {
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.merchantOnboardingApplication.updateMany({
        where: { id: applicationId, status: MerchantOnboardingStatus.IN_REVIEW },
        data: {
          status: MerchantOnboardingStatus.REJECTED,
          reviewedAt: now,
          rejectedAt: now,
          rejectionReason: dto.reason,
        },
      });

      if (claim.count !== 1) {
        await this.throwDecisionClaimError(tx, applicationId);
      }

      const application = await this.findApplicationAfterClaim(tx, applicationId);
      const updated = {
        ...application,
        status: MerchantOnboardingStatus.REJECTED,
        reviewedAt: now,
        rejectedAt: now,
        rejectionReason: dto.reason,
      };

      await tx.merchantOnboardingChecklistItem.updateMany({
        where: { applicationId: application.id, key: 'internal_review' },
        data: {
          status: MerchantOnboardingChecklistStatus.COMPLETED,
          completedAt: now,
        },
      });

      await tx.merchantOnboardingChecklistItem.updateMany({
        where: { applicationId: application.id, key: 'approval_decision' },
        data: {
          status: MerchantOnboardingChecklistStatus.BLOCKED,
          completedAt: now,
        },
      });

      await this.createDecisionEvent(tx, application.id, 'application_rejected', dto.reason);

      return updated;
    });

    await this.notifyMerchantDecisionEmail(updated.id, {
      to: updated.contactEmail,
      contactName: updated.contactName,
      decision: 'rejected',
      rejectionReason: dto.reason,
    });

    return updated;
  }

  /**
   * Revoca enlaces activos de una solicitud y emite un nuevo token público.
   */
  async resendLink(applicationId: string) {
    const application = await this.prisma.merchantOnboardingApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        contactName: true,
        contactEmail: true,
        status: true,
      },
    });

    if (!application) {
      throw new NotFoundException('Merchant onboarding application not found');
    }

    if (application.status !== MerchantOnboardingStatus.DOCUMENTATION_PENDING) {
      throw new BadRequestException('Onboarding link can only be resent for pending documentation');
    }

    const now = new Date();
    const token = await this.createTokenValues(now);

    await this.prisma.$transaction(async (tx) => {
      await tx.merchantOnboardingToken.updateMany({
        where: {
          applicationId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });

      await tx.merchantOnboardingToken.create({
        data: {
          applicationId,
          tokenHash: token.hash,
          expiresAt: token.expiresAt,
        },
      });

      await tx.merchantOnboardingEvent.create({
        data: {
          applicationId,
          type: 'ONBOARDING_LINK_SENT',
          actorType: MerchantOnboardingActorType.SYSTEM,
          message: 'Link de onboarding reenviado.',
        },
      });
    });

    const emailResult = await this.sendOnboardingEmail({
      to: application.contactEmail,
      contactName: application.contactName,
      onboardingUrl: this.buildOnboardingUrl(token.plain),
    });
    await this.recordEmailDeliveryEvent(applicationId, emailResult);

    return { ok: true, message: PUBLIC_RESEND_MESSAGE };
  }

  private publicCreateResponse(onboardingUrl?: string) {
    return {
      ok: true,
      message: PUBLIC_CREATE_MESSAGE,
      ...(onboardingUrl && this.shouldExposeOnboardingUrl() ? { onboardingUrl } : {}),
    };
  }

  private shouldExposeOnboardingUrl(): boolean {
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'sandbox';
  }

  private async sendOnboardingEmail(input: {
    to: string;
    contactName: string;
    onboardingUrl: string;
  }): Promise<EmailDeliveryResult> {
    try {
      return await this.emailService.sendOnboardingLink(input);
    } catch (error) {
      return { ok: false, errorMessage: getErrorMessage(error) };
    }
  }

  private async notifyMerchantDecisionEmail(
    applicationId: string,
    input: {
      to: string;
      contactName: string;
      decision: 'approved' | 'rejected';
      rejectionReason?: string;
    },
  ): Promise<void> {
    let emailResult: EmailDeliveryResult;
    try {
      emailResult = await this.emailService.sendOnboardingDecisionEmail({
        to: input.to,
        contactName: input.contactName,
        decision: input.decision,
        rejectionReason: input.rejectionReason,
      });
    } catch (error) {
      emailResult = { ok: false, errorMessage: getErrorMessage(error) };
    }
    try {
      await this.recordDecisionEmailDeliveryEvent(applicationId, input.decision, emailResult);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to record decision email delivery event (applicationId=${applicationId}, decision=${input.decision}): ${getErrorMessage(error)}`,
      );
    }
  }

  private async recordDecisionEmailDeliveryEvent(
    applicationId: string,
    decision: 'approved' | 'rejected',
    emailResult: EmailDeliveryResult,
  ): Promise<void> {
    if (emailResult.ok) {
      await this.prisma.merchantOnboardingEvent.create({
        data: {
          applicationId,
          type: 'decision_email_sent',
          actorType: MerchantOnboardingActorType.SYSTEM,
          message:
            decision === 'approved'
              ? 'Email de aprobación de onboarding enviado al contacto.'
              : 'Email de rechazo de onboarding enviado al contacto.',
          metadata: { decision, providerMessageId: emailResult.providerMessageId },
        },
      });
      return;
    }

    await this.prisma.merchantOnboardingEvent.create({
      data: {
        applicationId,
        type: 'decision_email_failed',
        actorType: MerchantOnboardingActorType.SYSTEM,
        message: 'No se pudo enviar el email de decisión de onboarding al contacto.',
        metadata: { decision, errorMessage: emailResult.errorMessage },
      },
    });
  }

  private async recordEmailDeliveryEvent(
    applicationId: string,
    emailResult: EmailDeliveryResult,
  ): Promise<void> {
    if (emailResult.ok) {
      await this.prisma.merchantOnboardingEvent.create({
        data: {
          applicationId,
          type: 'onboarding_email_sent',
          actorType: MerchantOnboardingActorType.SYSTEM,
          message: 'Email de onboarding enviado.',
          metadata: { providerMessageId: emailResult.providerMessageId },
        },
      });
      return;
    }

    await this.prisma.merchantOnboardingEvent.create({
      data: {
        applicationId,
        type: 'onboarding_email_failed',
        actorType: MerchantOnboardingActorType.SYSTEM,
        message: 'No se pudo enviar el email de onboarding.',
        metadata: { errorMessage: emailResult.errorMessage },
      },
    });
  }

  private async createTokenValues(now: Date) {
    const plain = this.tokenService.generatePlainToken();
    const ttlHours = this.getTokenTtlHours();
    return {
      plain,
      hash: this.tokenService.hashToken(plain),
      expiresAt: this.tokenService.computeExpiresAt(ttlHours, now),
    };
  }

  private getTokenTtlHours(): number {
    const value = this.config.get<string | number>('MERCHANT_ONBOARDING_TOKEN_TTL_HOURS') ?? 168;
    const ttlHours = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(ttlHours) || ttlHours < 1) {
      throw new Error('MERCHANT_ONBOARDING_TOKEN_TTL_HOURS must be a positive integer');
    }
    return ttlHours;
  }

  private buildOnboardingUrl(token: string): string {
    const baseUrl =
      this.config.get<string>('MERCHANT_ONBOARDING_BASE_URL') ?? 'http://localhost:3005';
    return `${baseUrl.replace(/\/+$/, '')}/onboarding/${encodeURIComponent(token)}`;
  }

  private async findApplicationAfterClaim(tx: OnboardingTransaction, applicationId: string) {
    const application = await tx.merchantOnboardingApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        merchantId: true,
        status: true,
        contactName: true,
        contactEmail: true,
        merchant: { select: { id: true, isActive: true } },
      },
    });

    if (!application) {
      throw new NotFoundException('Merchant onboarding application not found');
    }

    return application;
  }

  private async throwDecisionClaimError(
    tx: OnboardingTransaction,
    applicationId: string,
  ): Promise<never> {
    const application = await tx.merchantOnboardingApplication.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true },
    });

    if (!application) {
      throw new NotFoundException('Merchant onboarding application not found');
    }

    throw new ConflictException('Application must be in review before a decision');
  }

  private async createDecisionEvent(
    tx: OnboardingTransaction,
    applicationId: string,
    type: 'application_approved' | 'application_rejected' | 'merchant_activated',
    message: string,
  ): Promise<void> {
    await tx.merchantOnboardingEvent.create({
      data: {
        applicationId,
        type,
        actorType: MerchantOnboardingActorType.ADMIN,
        message,
      },
    });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown onboarding email error';
}

function sanitizeApplicationMerchant<T extends ApplicationWithMerchant>(application: T): T {
  if (!application.merchant) {
    return application;
  }

  return {
    ...application,
    merchant: {
      id: application.merchant.id,
      name: application.merchant.name,
      isActive: application.merchant.isActive,
      deactivatedAt: application.merchant.deactivatedAt,
      createdAt: application.merchant.createdAt,
    },
  };
}
