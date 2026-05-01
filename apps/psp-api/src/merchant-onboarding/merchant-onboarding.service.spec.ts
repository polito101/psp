import { ConfigService } from '@nestjs/config';
import { MerchantsService } from '../merchants/merchants.service';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantOnboardingService } from './merchant-onboarding.service';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';

describe('MerchantOnboardingService', () => {
  function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
    const map: Record<string, string | undefined> = {
      NODE_ENV: 'test',
      MERCHANT_ONBOARDING_BASE_URL: 'http://localhost:3005',
      ...overrides,
    };
    return { get: (k: string) => map[k] } as ConfigService;
  }

  it('ante violación de unicidad en contact_email devuelve publicCreateResponse neutral', async () => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue({
        code: 'P2002',
        meta: { modelName: 'MerchantOnboardingApplication', target: ['contact_email'] },
      }),
    } as unknown as PrismaService;

    const svc = new MerchantOnboardingService(
      prisma,
      {} as MerchantsService,
      {} as OnboardingEmailService,
      new OnboardingTokenService(),
      makeConfig(),
    );

    await expect(
      svc.createApplication({
        name: 'Test User',
        email: 'dup@example.com',
        phone: '+34000000000',
      }),
    ).resolves.toEqual({ ok: true });
  });
});
