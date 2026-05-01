import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MerchantOnboardingService } from './merchant-onboarding.service';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';

@Module({
  imports: [PrismaModule, MerchantsModule],
  providers: [MerchantOnboardingService, OnboardingEmailService, OnboardingTokenService],
  exports: [MerchantOnboardingService],
})
export class MerchantOnboardingModule {}
