import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { encryptUtf8 } from '../crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import {
  MerchantOnboardingActorType,
  MerchantOnboardingChecklistStatus,
  MerchantOnboardingStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import { CreateMerchantOnboardingApplicationDto } from './dto/create-merchant-onboarding-application.dto';
import { ListMerchantOnboardingApplicationsQueryDto } from './dto/list-merchant-onboarding-applications-query.dto';
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

type OnboardingTransaction = Prisma.TransactionClient;

@Injectable()
export class MerchantOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: OnboardingTokenService,
    private readonly emailService: OnboardingEmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea una solicitud pública de onboarding sin revelar si el email ya existe.
   * El merchant queda inactivo hasta que el backoffice apruebe la aplicación.
   */
  async createApplication(dto: CreateMerchantOnboardingApplicationDto) {
    const contactEmail = normalizeEmail(dto.email);
    const existing = await this.prisma.merchantOnboardingApplication.findFirst({
      where: { contactEmail },
      select: { id: true },
    });

    if (existing) {
      return this.publicCreateResponse();
    }

    const now = new Date();
    const token = await this.createTokenValues(now);
    const webhookSecretPlain = `whsec_${randomBytes(24).toString('base64url')}`;
    const webhookSecretCiphertext = encryptUtf8(webhookSecretPlain);
    const placeholderHash = await bcrypt.hash(randomBytes(16).toString('hex'), 12);

    await this.prisma.$transaction(async (tx) => {
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
    });

    await this.emailService.sendOnboardingLink({
      to: contactEmail,
      contactName: dto.name,
      onboardingUrl: this.buildOnboardingUrl(token.plain),
    });

    return this.publicCreateResponse();
  }

  /**
   * Valida un token público y devuelve la fila asociada si sigue usable.
   */
  async validateToken(token: string) {
    const tokenHash = this.tokenService.hashToken(token);
    const row = await this.prisma.merchantOnboardingToken.findUnique({
      where: { tokenHash },
      include: {
        application: true,
      },
    });

    if (!row || row.usedAt || row.revokedAt || row.expiresAt <= new Date()) {
      throw new BadRequestException('Invalid or expired onboarding token');
    }

    if (row.application.status !== MerchantOnboardingStatus.DOCUMENTATION_PENDING) {
      throw new BadRequestException('Onboarding token is not valid for this application');
    }

    return row;
  }

  /**
   * Guarda el perfil de negocio desde el enlace público y pasa la solicitud a revisión interna.
   */
  async submitBusinessProfile(token: string, dto: SubmitBusinessProfileDto) {
    const tokenRow = await this.validateToken(token);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
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

      await tx.merchantOnboardingToken.update({
        where: { id: tokenRow.id },
        data: { usedAt: now },
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

  async listApplications(query: ListMerchantOnboardingApplicationsQueryDto) {
    const pageSize = query.pageSize ?? 50;
    const q = query.q?.trim();
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

    const [items, total] = await Promise.all([
      this.prisma.merchantOnboardingApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        include: {
          merchant: true,
          checklistItems: true,
        },
      }),
      this.prisma.merchantOnboardingApplication.count({ where }),
    ]);

    return { items, total, pageSize };
  }

  async getApplication(applicationId: string) {
    const application = await this.prisma.merchantOnboardingApplication.findUnique({
      where: { id: applicationId },
      include: {
        merchant: true,
        checklistItems: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!application) {
      throw new NotFoundException('Merchant onboarding application not found');
    }

    return application;
  }

  /**
   * Aprueba una solicitud y activa el merchant en una única transacción.
   */
  async approveApplication(applicationId: string) {
    const application = await this.findApplicationForDecision(applicationId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.merchantOnboardingApplication.update({
        where: { id: application.id },
        data: {
          status: MerchantOnboardingStatus.ACTIVE,
          reviewedAt: now,
          approvedAt: now,
          activatedAt: now,
          rejectionReason: null,
        },
      });

      await tx.merchantOnboardingChecklistItem.updateMany({
        where: {
          applicationId: application.id,
          key: { in: ['internal_review', 'approval_decision', 'merchant_activation'] },
        },
        data: {
          status: MerchantOnboardingChecklistStatus.COMPLETED,
          completedAt: now,
        },
      });

      await tx.merchant.update({
        where: { id: application.merchantId },
        data: { isActive: true, deactivatedAt: null },
      });

      await this.createDecisionEvent(tx, application.id, 'APPLICATION_APPROVED', 'Solicitud aprobada.');

      return updated;
    });
  }

  /**
   * Rechaza una solicitud sin activar el merchant asociado.
   */
  async rejectApplication(applicationId: string, dto: RejectMerchantOnboardingDto) {
    const application = await this.findApplicationForDecision(applicationId);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.merchantOnboardingApplication.update({
        where: { id: application.id },
        data: {
          status: MerchantOnboardingStatus.REJECTED,
          reviewedAt: now,
          rejectedAt: now,
          rejectionReason: dto.reason,
        },
      });

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

      await this.createDecisionEvent(tx, application.id, 'APPLICATION_REJECTED', dto.reason);

      return updated;
    });
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

    await this.emailService.sendOnboardingLink({
      to: application.contactEmail,
      contactName: application.contactName,
      onboardingUrl: this.buildOnboardingUrl(token.plain),
    });

    return { ok: true, message: PUBLIC_RESEND_MESSAGE };
  }

  private publicCreateResponse() {
    return { ok: true, message: PUBLIC_CREATE_MESSAGE };
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
    return `${baseUrl.replace(/\/+$/, '')}/onboarding/merchant/${encodeURIComponent(token)}`;
  }

  private async findApplicationForDecision(applicationId: string) {
    const application = await this.prisma.merchantOnboardingApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        merchantId: true,
        status: true,
        merchant: { select: { id: true, isActive: true } },
      },
    });

    if (!application) {
      throw new NotFoundException('Merchant onboarding application not found');
    }

    if (application.status !== MerchantOnboardingStatus.IN_REVIEW) {
      throw new BadRequestException('Application must be in review before a decision');
    }

    return application;
  }

  private async createDecisionEvent(
    tx: OnboardingTransaction,
    applicationId: string,
    type: 'APPLICATION_APPROVED' | 'APPLICATION_REJECTED',
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
