import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OnboardingEmailService } from './onboarding-email.service';
import { OnboardingTokenService } from './onboarding-token.service';
import { MerchantOnboardingController } from './merchant-onboarding.controller';
import { MerchantOnboardingOpsController } from './merchant-onboarding-ops.controller';
import { MerchantOnboardingService } from './merchant-onboarding.service';

@Module({
  imports: [PrismaModule],
  controllers: [MerchantOnboardingController, MerchantOnboardingOpsController],
  providers: [MerchantOnboardingService, OnboardingTokenService, OnboardingEmailService],
  exports: [MerchantOnboardingService],
})
export class MerchantOnboardingModule {}
