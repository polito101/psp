import { Module } from '@nestjs/common';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';
import { MerchantOnboardingService } from './merchant-onboarding.service';

@Module({
  providers: [MerchantOnboardingService, OnboardingTokenService, OnboardingEmailService],
  exports: [MerchantOnboardingService],
})
export class MerchantOnboardingModule {}
