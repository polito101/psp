import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';
import { MerchantOnboardingService } from './merchant-onboarding.service';

@Module({
  imports: [PrismaModule],
  providers: [MerchantOnboardingService, OnboardingTokenService, OnboardingEmailService],
  exports: [MerchantOnboardingService],
})
export class MerchantOnboardingModule {}
