import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MerchantOnboardingService } from './merchant-onboarding.service';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';

describe('MerchantOnboardingService', () => {
  const now = new Date('2026-04-30T10:00:00.000Z');
  const expiresAt = new Date('2026-05-01T10:00:00.000Z');

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-with-at-least-32-chars';
  });

  const createTx = () => ({
    merchant: {
      create: jest.fn().mockResolvedValue({ id: 'merchant_1', name: 'Ada Lovelace' }),
      update: jest.fn().mockResolvedValue({ id: 'merchant_1', isActive: true }),
    },
    merchantOnboardingApplication: {
      create: jest.fn().mockResolvedValue({
        id: 'app_1',
        merchantId: 'merchant_1',
        contactName: 'Ada Lovelace',
        contactEmail: 'ada@example.com',
        status: 'ACCOUNT_CREATED',
      }),
      update: jest.fn().mockResolvedValue({
        id: 'app_1',
        merchantId: 'merchant_1',
        status: 'DOCUMENTATION_PENDING',
      }),
    },
    merchantOnboardingChecklistItem: {
      createMany: jest.fn().mockResolvedValue({ count: 5 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    merchantOnboardingToken: {
      create: jest.fn().mockResolvedValue({ id: 'tok_1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({ id: 'tok_1', usedAt: now }),
    },
    merchantOnboardingEvent: {
      create: jest.fn().mockResolvedValue({ id: 'evt_1' }),
    },
  });

  const createPrisma = () => {
    const tx = createTx();
    return {
      tx,
      prisma: {
        merchant: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        merchantOnboardingApplication: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
          update: jest.fn(),
        },
        merchantOnboardingToken: {
          findUnique: jest.fn(),
        },
        $transaction: jest.fn(async <T>(callback: (transaction: typeof tx) => Promise<T>) =>
          callback(tx),
        ),
      },
    };
  };

  const createService = () => {
    const { prisma, tx } = createPrisma();
    const tokenService = {
      generatePlainToken: jest.fn().mockReturnValue('plain_token'),
      hashToken: jest.fn().mockReturnValue('hashed_token'),
      computeExpiresAt: jest.fn().mockReturnValue(expiresAt),
    } satisfies Pick<OnboardingTokenService, 'generatePlainToken' | 'hashToken' | 'computeExpiresAt'>;
    const emailService = {
      sendOnboardingLink: jest.fn().mockResolvedValue({ ok: true, providerMessageId: 'email_1' }),
    } satisfies Pick<OnboardingEmailService, 'sendOnboardingLink'>;
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'MERCHANT_ONBOARDING_BASE_URL') return 'https://onboarding.example.com';
        if (key === 'MERCHANT_ONBOARDING_TOKEN_TTL_HOURS') return 24;
        return undefined;
      }),
    } satisfies Pick<ConfigService, 'get'>;

    return {
      service: new MerchantOnboardingService(
        prisma as never,
        tokenService as OnboardingTokenService,
        emailService as unknown as OnboardingEmailService,
        config as unknown as ConfigService,
      ),
      prisma,
      tx,
      tokenService,
      emailService,
    };
  };

  it('creates merchant inactive, application, checklist, token, and events', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, tx, tokenService, emailService } = createService();

    const result = await service.createApplication({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+34600000000',
    });

    expect(tx.merchant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Ada Lovelace',
        isActive: false,
        deactivatedAt: now,
      }),
    });
    expect(tx.merchantOnboardingApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: 'merchant_1',
        contactName: 'Ada Lovelace',
        contactEmail: 'ada@example.com',
        contactPhone: '+34600000000',
        status: 'ACCOUNT_CREATED',
      }),
    });
    expect(tx.merchantOnboardingChecklistItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          applicationId: 'app_1',
          key: 'basic_contact_created',
          status: 'COMPLETED',
          completedAt: now,
        }),
        expect.objectContaining({
          applicationId: 'app_1',
          key: 'business_profile_submitted',
          status: 'PENDING',
        }),
      ]),
    });
    expect(tx.merchantOnboardingToken.create).toHaveBeenCalledWith({
      data: {
        applicationId: 'app_1',
        tokenHash: 'hashed_token',
        expiresAt,
      },
    });
    expect(tx.merchantOnboardingApplication.update).toHaveBeenCalledWith({
      where: { id: 'app_1' },
      data: { status: 'DOCUMENTATION_PENDING' },
    });
    expect(tx.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'APPLICATION_CREATED',
        actorType: 'SYSTEM',
      }),
    });
    expect(tx.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'ONBOARDING_LINK_SENT',
        actorType: 'SYSTEM',
      }),
    });
    expect(tokenService.computeExpiresAt).toHaveBeenCalledWith(24, now);
    expect(emailService.sendOnboardingLink).toHaveBeenCalledWith({
      to: 'ada@example.com',
      contactName: 'Ada Lovelace',
      onboardingUrl: 'https://onboarding.example.com/onboarding/merchant/plain_token',
    });
    expect(result).toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
    });
    jest.useRealTimers();
  });

  it('returns neutral success for duplicate public emails without exposing records', async () => {
    const { service, prisma, tx, emailService } = createService();
    prisma.merchantOnboardingApplication.findFirst.mockResolvedValue({ id: 'existing_app' });

    const result = await service.createApplication({
      name: 'Ada Lovelace',
      email: 'ADA@example.com',
      phone: '+34600000000',
    });

    expect(tx.merchant.create).not.toHaveBeenCalled();
    expect(emailService.sendOnboardingLink).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
    });
  });

  it('submits business profile with a valid token and moves to IN_REVIEW', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx } = createService();
    prisma.merchantOnboardingToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      applicationId: 'app_1',
      expiresAt: new Date('2026-05-01T10:00:00.000Z'),
      usedAt: null,
      revokedAt: null,
      application: { id: 'app_1', status: 'DOCUMENTATION_PENDING' },
    });
    tx.merchantOnboardingApplication.update.mockResolvedValue({
      id: 'app_1',
      status: 'IN_REVIEW',
      tradeName: 'Ada Shop',
    });

    const result = await service.submitBusinessProfile('plain_token', {
      tradeName: 'Ada Shop',
      legalName: 'Ada Shop SL',
      country: 'ES',
      website: 'https://adashop.example',
      businessType: 'ecommerce',
    });

    expect(tx.merchantOnboardingApplication.update).toHaveBeenCalledWith({
      where: { id: 'app_1' },
      data: expect.objectContaining({
        status: 'IN_REVIEW',
        tradeName: 'Ada Shop',
        legalName: 'Ada Shop SL',
        country: 'ES',
        website: 'https://adashop.example',
        businessType: 'ecommerce',
        submittedAt: now,
      }),
    });
    expect(tx.merchantOnboardingChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { applicationId: 'app_1', key: 'business_profile_submitted' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    expect(tx.merchantOnboardingToken.update).toHaveBeenCalledWith({
      where: { id: 'tok_1' },
      data: { usedAt: now },
    });
    expect(tx.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'BUSINESS_PROFILE_SUBMITTED',
        actorType: 'MERCHANT',
      }),
    });
    expect(result.status).toBe('IN_REVIEW');
    jest.useRealTimers();
  });

  it('rejects expired or used tokens', async () => {
    const { service, prisma } = createService();
    prisma.merchantOnboardingToken.findUnique.mockResolvedValueOnce({
      id: 'tok_expired',
      applicationId: 'app_1',
      expiresAt: new Date('2026-04-29T10:00:00.000Z'),
      usedAt: null,
      revokedAt: null,
      application: { id: 'app_1', status: 'DOCUMENTATION_PENDING' },
    });
    await expect(service.validateToken('expired_token')).rejects.toBeInstanceOf(BadRequestException);

    prisma.merchantOnboardingToken.findUnique.mockResolvedValueOnce({
      id: 'tok_used',
      applicationId: 'app_1',
      expiresAt: new Date('2026-05-01T10:00:00.000Z'),
      usedAt: now,
      revokedAt: null,
      application: { id: 'app_1', status: 'DOCUMENTATION_PENDING' },
    });
    await expect(service.validateToken('used_token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves application and activates merchant atomically', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx } = createService();
    prisma.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      merchantId: 'merchant_1',
      status: 'IN_REVIEW',
      merchant: { id: 'merchant_1', isActive: false },
    });
    tx.merchantOnboardingApplication.update.mockResolvedValue({
      id: 'app_1',
      status: 'ACTIVE',
      merchantId: 'merchant_1',
    });

    const result = await service.approveApplication('app_1');

    expect(tx.merchantOnboardingApplication.update).toHaveBeenCalledWith({
      where: { id: 'app_1' },
      data: {
        status: 'ACTIVE',
        reviewedAt: now,
        approvedAt: now,
        activatedAt: now,
        rejectionReason: null,
      },
    });
    expect(tx.merchantOnboardingChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { applicationId: 'app_1', key: { in: ['internal_review', 'approval_decision', 'merchant_activation'] } },
      data: { status: 'COMPLETED', completedAt: now },
    });
    expect(tx.merchant.update).toHaveBeenCalledWith({
      where: { id: 'merchant_1' },
      data: { isActive: true, deactivatedAt: null },
    });
    expect(tx.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'APPLICATION_APPROVED',
        actorType: 'ADMIN',
      }),
    });
    expect(result.status).toBe('ACTIVE');
    jest.useRealTimers();
  });

  it('rejects application and keeps merchant inactive', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx } = createService();
    prisma.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      merchantId: 'merchant_1',
      status: 'IN_REVIEW',
      merchant: { id: 'merchant_1', isActive: false },
    });
    tx.merchantOnboardingApplication.update.mockResolvedValue({
      id: 'app_1',
      status: 'REJECTED',
      rejectionReason: 'No cumple los requisitos de riesgo actuales.',
    });

    const result = await service.rejectApplication('app_1', {
      reason: 'No cumple los requisitos de riesgo actuales.',
    });

    expect(tx.merchantOnboardingApplication.update).toHaveBeenCalledWith({
      where: { id: 'app_1' },
      data: {
        status: 'REJECTED',
        reviewedAt: now,
        rejectedAt: now,
        rejectionReason: 'No cumple los requisitos de riesgo actuales.',
      },
    });
    expect(tx.merchant.update).not.toHaveBeenCalled();
    expect(tx.merchantOnboardingChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { applicationId: 'app_1', key: { in: ['internal_review', 'approval_decision'] } },
      data: { status: 'COMPLETED', completedAt: now },
    });
    expect(result.status).toBe('REJECTED');
    jest.useRealTimers();
  });

  it('resends link by revoking active tokens and creating a new token', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx, emailService } = createService();
    prisma.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
      status: 'DOCUMENTATION_PENDING',
    });

    const result = await service.resendLink('app_1');

    expect(tx.merchantOnboardingToken.updateMany).toHaveBeenCalledWith({
      where: {
        applicationId: 'app_1',
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });
    expect(tx.merchantOnboardingToken.create).toHaveBeenCalledWith({
      data: {
        applicationId: 'app_1',
        tokenHash: 'hashed_token',
        expiresAt,
      },
    });
    expect(emailService.sendOnboardingLink).toHaveBeenCalledWith({
      to: 'ada@example.com',
      contactName: 'Ada Lovelace',
      onboardingUrl: 'https://onboarding.example.com/onboarding/merchant/plain_token',
    });
    expect(result).toEqual({
      ok: true,
      message: 'If the application can receive onboarding links, we will send next steps shortly.',
    });
    jest.useRealTimers();
  });

  it('throws NotFoundException when getting an unknown application', async () => {
    const { service, prisma } = createService();
    prisma.merchantOnboardingApplication.findUnique.mockResolvedValue(null);

    await expect(service.getApplication('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
