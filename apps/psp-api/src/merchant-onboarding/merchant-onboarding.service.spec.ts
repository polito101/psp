import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { MerchantOnboardingService } from './merchant-onboarding.service';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';

describe('MerchantOnboardingService', () => {
  const now = new Date('2026-04-30T10:00:00.000Z');
  const expiresAt = new Date('2026-05-01T10:00:00.000Z');

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = 'test-encryption-key-with-at-least-32-chars';
    process.env.NODE_ENV = 'test';
  });

  const createTx = () => ({
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    merchant: {
      create: jest.fn().mockResolvedValue({ id: 'merchant_1', name: 'Ada Lovelace' }),
      update: jest.fn().mockResolvedValue({ id: 'merchant_1', isActive: true }),
    },
    merchantOnboardingApplication: {
      findFirst: jest.fn().mockResolvedValue(null),
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
      findUnique: jest.fn().mockResolvedValue({
        id: 'app_1',
        merchantId: 'merchant_1',
        status: 'APPROVED',
        contactName: 'Ada Lovelace',
        contactEmail: 'ada@example.com',
        merchant: { id: 'merchant_1', isActive: false },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
        merchantOnboardingEvent: {
          create: jest.fn().mockResolvedValue({ id: 'evt_root_1' }),
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
      sendOnboardingDecisionEmail: jest
        .fn()
        .mockResolvedValue({ ok: true, providerMessageId: 'email_decision_1' }),
    } satisfies Pick<OnboardingEmailService, 'sendOnboardingLink' | 'sendOnboardingDecisionEmail'>;
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

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.merchantOnboardingApplication.findFirst).toHaveBeenCalledWith({
      where: { contactEmail: 'ada@example.com' },
      select: { id: true },
    });
    const createdMerchantData = tx.merchant.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(createdMerchantData).toMatchObject({
      name: 'Ada Lovelace',
      isActive: false,
      deactivatedAt: now,
    });
    expect(createdMerchantData).not.toHaveProperty('merchantPortalPasswordHash');
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
      onboardingUrl: 'https://onboarding.example.com/onboarding/plain_token',
    });
    expect(result).toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
    });
    jest.useRealTimers();
  });

  it('records sent email event after creation without exposing the link in production-like environments', async () => {
    const { service, prisma } = createService();

    const result = await service.createApplication({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+34600000000',
    });

    expect(prisma.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'onboarding_email_sent',
        actorType: 'SYSTEM',
        metadata: { providerMessageId: 'email_1' },
      }),
    });
    expect(result).not.toHaveProperty('onboardingUrl');
  });

  it('records failed email event without rolling back the onboarding records', async () => {
    const { service, tx, prisma, emailService } = createService();
    emailService.sendOnboardingLink.mockResolvedValueOnce({
      ok: false,
      errorMessage: 'Resend is not configured',
    });

    const result = await service.createApplication({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+34600000000',
    });

    expect(tx.merchant.create).toHaveBeenCalled();
    expect(tx.merchantOnboardingApplication.create).toHaveBeenCalled();
    expect(tx.merchantOnboardingToken.create).toHaveBeenCalled();
    expect(tx.merchantOnboardingChecklistItem.createMany).toHaveBeenCalled();
    expect(prisma.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'onboarding_email_failed',
        actorType: 'SYSTEM',
        metadata: { errorMessage: 'Resend is not configured' },
      }),
    });
    expect(result).toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
    });
  });

  it('includes onboardingUrl in public creation responses for development and sandbox', async () => {
    const { service } = createService();
    process.env.NODE_ENV = 'development';

    await expect(
      service.createApplication({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: '+34600000000',
      }),
    ).resolves.toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
      onboardingUrl: 'https://onboarding.example.com/onboarding/plain_token',
    });

    const sandboxContext = createService();
    process.env.NODE_ENV = 'sandbox';

    await expect(
      sandboxContext.service.createApplication({
        name: 'Grace Hopper',
        email: 'grace@example.com',
        phone: '+34600000001',
      }),
    ).resolves.toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
      onboardingUrl: 'https://onboarding.example.com/onboarding/plain_token',
    });
  });

  it('returns neutral success for duplicate public emails without exposing records', async () => {
    const { service, prisma, tx, emailService } = createService();
    prisma.merchantOnboardingApplication.findFirst.mockResolvedValue({ id: 'existing_app' });

    const result = await service.createApplication({
      name: 'Ada Lovelace',
      email: 'ADA@example.com',
      phone: '+34600000000',
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.merchant.create).not.toHaveBeenCalled();
    expect(emailService.sendOnboardingLink).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
    });
  });

  it('returns neutral success when another request commits the same contact_email under the advisory lock', async () => {
    const { service, tx, emailService } = createService();
    tx.merchantOnboardingApplication.findFirst.mockResolvedValueOnce({ id: 'winner_app' });

    const result = await service.createApplication({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+34600000000',
    });

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.merchantOnboardingApplication.findFirst).toHaveBeenCalledWith({
      where: { contactEmail: 'ada@example.com' },
      select: { id: true },
    });
    expect(tx.merchant.create).not.toHaveBeenCalled();
    expect(emailService.sendOnboardingLink).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
    });
  });

  it('returns neutral success when DB unique constraint on contact_email races past findFirst', async () => {
    const dupError = {
      name: 'PrismaClientKnownRequestError',
      message: 'Unique constraint failed on the fields: (`contact_email`)',
      code: 'P2002',
      clientVersion: 'test',
      meta: { modelName: 'MerchantOnboardingApplication', target: ['contact_email'] },
    };
    const { service, prisma, tx, emailService } = createService();
    prisma.$transaction.mockRejectedValueOnce(dupError);

    const result = await service.createApplication({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+34600000000',
    });

    expect(tx.merchant.create).not.toHaveBeenCalled();
    expect(emailService.sendOnboardingLink).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      message: 'If the email can receive onboarding links, we will send next steps shortly.',
    });
  });

  it('rethrows P2002 that is not the onboarding contact_email unique violation', async () => {
    const err = {
      name: 'PrismaClientKnownRequestError',
      message: 'Unique constraint failed',
      code: 'P2002',
      clientVersion: 'test',
      meta: { modelName: 'MerchantOnboardingToken', target: ['token_hash'] },
    };
    const { service, prisma } = createService();
    prisma.$transaction.mockRejectedValueOnce(err);

    await expect(
      service.createApplication({
        name: 'Ada',
        email: 'ada@example.com',
        phone: '+34',
      }),
    ).rejects.toBe(err);
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

    expect(tx.merchantOnboardingToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'tok_1',
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
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

  it('does not submit when the token conditional consume claim loses the race', async () => {
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
    tx.merchantOnboardingToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.submitBusinessProfile('plain_token', {
        tradeName: 'Ada Shop',
        legalName: 'Ada Shop SL',
        country: 'ES',
        website: 'https://adashop.example',
        businessType: 'ecommerce',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.merchantOnboardingApplication.update).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('rejects expired, used, or revoked tokens', async () => {
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

    prisma.merchantOnboardingToken.findUnique.mockResolvedValueOnce({
      id: 'tok_revoked',
      applicationId: 'app_1',
      expiresAt: new Date('2026-05-01T10:00:00.000Z'),
      usedAt: null,
      revokedAt: now,
      application: { id: 'app_1', status: 'DOCUMENTATION_PENDING' },
    });
    await expect(service.validateToken('revoked_token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves application and activates merchant atomically', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx, emailService } = createService();
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
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
    });

    const result = await service.approveApplication('app_1');

    expect(tx.merchantOnboardingApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'app_1', status: 'IN_REVIEW' },
      data: {
        status: 'APPROVED',
        reviewedAt: now,
        approvedAt: now,
        rejectionReason: null,
      },
    });
    expect(tx.merchantOnboardingApplication.update).toHaveBeenCalledWith({
      where: { id: 'app_1' },
      data: {
        status: 'ACTIVE',
        activatedAt: now,
      },
    });
    expect(tx.merchantOnboardingChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { applicationId: 'app_1', key: { in: ['internal_review', 'approval_decision'] } },
      data: { status: 'COMPLETED', completedAt: now },
    });
    expect(tx.merchantOnboardingChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { applicationId: 'app_1', key: 'merchant_activation' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    expect(tx.merchant.update).toHaveBeenCalledWith({
      where: { id: 'merchant_1' },
      data: {
        isActive: true,
        deactivatedAt: null,
        merchantPortalPasswordHash: expect.any(String),
      },
    });
    expect(tx.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'application_approved',
        actorType: 'ADMIN',
      }),
    });
    expect(tx.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'merchant_activated',
        actorType: 'ADMIN',
      }),
    });
    expect(emailService.sendOnboardingDecisionEmail).toHaveBeenCalledWith({
      to: 'ada@example.com',
      contactName: 'Ada Lovelace',
      decision: 'approved',
      portalLoginEmail: 'ada@example.com',
      portalInitialPassword: expect.any(String),
    });
    expect(prisma.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'decision_email_sent',
        actorType: 'SYSTEM',
        metadata: { decision: 'approved', providerMessageId: 'email_decision_1' },
      }),
    });
    expect(result.status).toBe('ACTIVE');
    jest.useRealTimers();
  });

  it('does not fail approve/reject response when decision email audit insert fails', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, prisma, tx, emailService } = createService();
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
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
    });
    prisma.merchantOnboardingEvent.create.mockRejectedValueOnce(new Error('audit insert failed'));

    const approved = await service.approveApplication('app_1');
    expect(approved.status).toBe('ACTIVE');
    expect(emailService.sendOnboardingDecisionEmail).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to record decision email delivery event'),
    );

    prisma.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      merchantId: 'merchant_1',
      status: 'IN_REVIEW',
      merchant: { id: 'merchant_1', isActive: false },
    });
    tx.merchantOnboardingApplication.update.mockResolvedValue({
      id: 'app_1',
      status: 'REJECTED',
      rejectionReason: 'x',
    });
    prisma.merchantOnboardingEvent.create.mockRejectedValueOnce(new Error('audit insert failed'));

    const rejected = await service.rejectApplication('app_1', { reason: 'No pasa.' });
    expect(rejected.status).toBe('REJECTED');
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('does not approve when the conditional status claim loses the race', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx, emailService } = createService();
    tx.merchantOnboardingApplication.updateMany.mockResolvedValue({ count: 0 });
    tx.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      merchantId: 'merchant_1',
      status: 'REJECTED',
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
      merchant: { id: 'merchant_1', isActive: false },
    });

    await expect(service.approveApplication('app_1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.merchant.update).not.toHaveBeenCalled();
    expect(emailService.sendOnboardingDecisionEmail).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('rejects application and keeps merchant inactive', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx, emailService } = createService();
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

    expect(tx.merchantOnboardingApplication.updateMany).toHaveBeenCalledWith({
      where: { id: 'app_1', status: 'IN_REVIEW' },
      data: {
        status: 'REJECTED',
        reviewedAt: now,
        rejectedAt: now,
        rejectionReason: 'No cumple los requisitos de riesgo actuales.',
      },
    });
    expect(tx.merchant.update).not.toHaveBeenCalled();
    expect(tx.merchantOnboardingChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { applicationId: 'app_1', key: 'internal_review' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    expect(tx.merchantOnboardingChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { applicationId: 'app_1', key: 'approval_decision' },
      data: { status: 'BLOCKED', completedAt: now },
    });
    expect(emailService.sendOnboardingDecisionEmail).toHaveBeenCalledWith({
      to: 'ada@example.com',
      contactName: 'Ada Lovelace',
      decision: 'rejected',
      rejectionReason: 'No cumple los requisitos de riesgo actuales.',
    });
    expect(prisma.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'decision_email_sent',
        actorType: 'SYSTEM',
        metadata: { decision: 'rejected', providerMessageId: 'email_decision_1' },
      }),
    });
    expect(result.status).toBe('REJECTED');
    jest.useRealTimers();
  });

  it('does not reject when the conditional status claim loses the race', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, tx, emailService } = createService();
    tx.merchantOnboardingApplication.updateMany.mockResolvedValue({ count: 0 });
    tx.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      merchantId: 'merchant_1',
      status: 'ACTIVE',
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
      merchant: { id: 'merchant_1', isActive: true },
    });

    await expect(
      service.rejectApplication('app_1', {
        reason: 'No cumple los requisitos de riesgo actuales.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.merchant.update).not.toHaveBeenCalled();
    expect(emailService.sendOnboardingDecisionEmail).not.toHaveBeenCalled();
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
      onboardingUrl: 'https://onboarding.example.com/onboarding/plain_token',
    });
    expect(prisma.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'onboarding_email_sent',
        actorType: 'SYSTEM',
        metadata: { providerMessageId: 'email_1' },
      }),
    });
    expect(result).toEqual({
      ok: true,
      message: 'If the application can receive onboarding links, we will send next steps shortly.',
    });
    jest.useRealTimers();
  });

  it('records failed resend email event and still returns neutral message', async () => {
    jest.useFakeTimers().setSystemTime(now.getTime());
    const { service, prisma, emailService } = createService();
    prisma.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      contactName: 'Ada Lovelace',
      contactEmail: 'ada@example.com',
      status: 'DOCUMENTATION_PENDING',
    });
    emailService.sendOnboardingLink.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await service.resendLink('app_1');

    expect(prisma.merchantOnboardingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationId: 'app_1',
        type: 'onboarding_email_failed',
        actorType: 'SYSTEM',
        metadata: { errorMessage: 'SMTP down' },
      }),
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

  it('returns sanitized token validation data without token hashes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-30T12:00:00.000Z').getTime());
    const { service, prisma } = createService();
    prisma.merchantOnboardingToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      applicationId: 'app_1',
      tokenHash: 'hashed_token',
      expiresAt: new Date('2026-05-01T10:00:00.000Z'),
      usedAt: null,
      revokedAt: null,
      application: { id: 'app_1', status: 'DOCUMENTATION_PENDING' },
    });

    const result = await service.validateToken('plain_token');

    expect(result).toEqual({
      id: 'tok_1',
      applicationId: 'app_1',
      expiresAt: new Date('2026-05-01T10:00:00.000Z'),
      application: { id: 'app_1', status: 'DOCUMENTATION_PENDING' },
    });
    expect(result).not.toHaveProperty('tokenHash');
    jest.useRealTimers();
  });

  it('returns sanitized application detail without merchant secrets', async () => {
    const { service, prisma } = createService();
    prisma.merchantOnboardingApplication.findUnique.mockResolvedValue({
      id: 'app_1',
      merchantId: 'merchant_1',
      status: 'IN_REVIEW',
      contactEmail: 'ada@example.com',
      merchant: {
        id: 'merchant_1',
        name: 'Ada Lovelace',
        isActive: false,
        apiKeyHash: 'secret_hash',
        webhookSecretCiphertext: 'secret_ciphertext',
      },
      checklistItems: [],
      events: [],
    });

    const result = await service.getApplication('app_1');

    expect(result.merchant).toEqual({
      id: 'merchant_1',
      name: 'Ada Lovelace',
      isActive: false,
      deactivatedAt: undefined,
      createdAt: undefined,
    });
    expect(result.merchant).not.toHaveProperty('apiKeyHash');
    expect(result.merchant).not.toHaveProperty('webhookSecretCiphertext');
  });

  it('returns sanitized application list without merchant secrets', async () => {
    const { service, prisma } = createService();
    prisma.merchantOnboardingApplication.findMany.mockResolvedValue([
      {
        id: 'app_1',
        merchantId: 'merchant_1',
        status: 'IN_REVIEW',
        contactEmail: 'ada@example.com',
        merchant: {
          id: 'merchant_1',
          name: 'Ada Lovelace',
          isActive: false,
          apiKeyHash: 'secret_hash',
          webhookSecretCiphertext: 'secret_ciphertext',
        },
        checklistItems: [],
      },
    ]);
    prisma.merchantOnboardingApplication.count.mockResolvedValue(1);

    const result = await service.listApplications({});

    expect(result.items[0].merchant).toEqual({
      id: 'merchant_1',
      name: 'Ada Lovelace',
      isActive: false,
      deactivatedAt: undefined,
      createdAt: undefined,
    });
    expect(result.items[0].merchant).not.toHaveProperty('apiKeyHash');
    expect(result.items[0].merchant).not.toHaveProperty('webhookSecretCiphertext');
  });

  it('listApplications rejects search text longer than the configured maximum', async () => {
    const { service } = createService();
    const q = 'x'.repeat(101);

    await expect(service.listApplications({ q })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listApplications with q avoids count and caps total when more than pageSize matches', async () => {
    const { service, prisma } = createService();
    const row = {
      id: 'app_1',
      merchantId: 'merchant_1',
      status: 'IN_REVIEW',
      contactEmail: 'ada@example.com',
      contactName: 'Ada',
      contactPhone: '',
      tradeName: null,
      legalName: null,
      country: null,
      website: null,
      businessType: null,
      rejectionReason: null,
      submittedAt: null,
      reviewedAt: null,
      approvedAt: null,
      rejectedAt: null,
      activatedAt: null,
      createdAt: now,
      updatedAt: now,
      merchant: null,
      checklistItems: [],
    };
    prisma.merchantOnboardingApplication.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({ ...row, id: `app_${i}` })),
    );

    const result = await service.listApplications({ q: 'ada', pageSize: 50 });

    expect(prisma.merchantOnboardingApplication.count).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(51);
  });

  describe('validateMerchantPortalLogin', () => {
    it('returns merchant id, onboarding status and rejection reason when password matches', async () => {
      const { service, prisma } = createService();
      const password = 'validpass12';
      const hash = await bcrypt.hash(password, 4);
      prisma.merchantOnboardingApplication.findFirst.mockResolvedValue({
        merchantId: 'm_1',
        status: 'IN_REVIEW',
        rejectionReason: 'Prior check',
        merchant: { merchantPortalPasswordHash: hash },
      });

      const result = await service.validateMerchantPortalLogin('  USER@EXAMPLE.COM ', password);

      expect(prisma.merchantOnboardingApplication.findFirst).toHaveBeenCalledWith({
        where: { contactEmail: 'user@example.com' },
        orderBy: { createdAt: 'desc' },
        select: {
          merchantId: true,
          status: true,
          rejectionReason: true,
          merchant: { select: { merchantPortalPasswordHash: true } },
        },
      });
      expect(result).toEqual({
        merchantId: 'm_1',
        onboardingStatus: 'IN_REVIEW',
        rejectionReason: 'Prior check',
      });
    });

    it('throws Unauthorized when password does not match', async () => {
      const { service, prisma } = createService();
      const hash = await bcrypt.hash('othersecret', 4);
      prisma.merchantOnboardingApplication.findFirst.mockResolvedValue({
        merchantId: 'm_1',
        status: 'APPROVED',
        rejectionReason: null,
        merchant: { merchantPortalPasswordHash: hash },
      });

      await expect(
        service.validateMerchantPortalLogin('user@example.com', 'wrongpassword'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws Unauthorized when no application exists for email', async () => {
      const { service, prisma } = createService();
      prisma.merchantOnboardingApplication.findFirst.mockResolvedValue(null);

      await expect(service.validateMerchantPortalLogin('none@example.com', 'password12')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized when merchant portal password hash is missing', async () => {
      const { service, prisma } = createService();
      prisma.merchantOnboardingApplication.findFirst.mockResolvedValue({
        merchantId: 'm_1',
        status: 'ACCOUNT_CREATED',
        rejectionReason: null,
        merchant: { merchantPortalPasswordHash: null },
      });

      await expect(
        service.validateMerchantPortalLogin('user@example.com', 'password12'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
