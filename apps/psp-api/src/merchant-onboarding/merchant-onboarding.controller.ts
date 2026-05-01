import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateMerchantOnboardingApplicationDto } from './dto/create-merchant-onboarding-application.dto';
import { SubmitBusinessProfileDto } from './dto/submit-business-profile.dto';
import { MerchantOnboardingService } from './merchant-onboarding.service';

@ApiTags('merchant-onboarding')
@Controller({ path: 'merchant-onboarding', version: '1' })
export class MerchantOnboardingController {
  constructor(private readonly service: MerchantOnboardingService) {}

  @Post('applications')
  @ApiOperation({ summary: 'Solicitar alta merchant y enviar link de onboarding' })
  createApplication(@Body() dto: CreateMerchantOnboardingApplicationDto) {
    return this.service.createApplication(dto);
  }

  @Get('tokens/:token')
  @ApiOperation({ summary: 'Validar link público de onboarding' })
  validateToken(@Param('token') token: string) {
    return this.service.validateToken(token);
  }

  @Post('tokens/:token/business-profile')
  @ApiOperation({ summary: 'Enviar datos básicos de negocio desde link público' })
  submitBusinessProfile(@Param('token') token: string, @Body() dto: SubmitBusinessProfileDto) {
    return this.service.submitBusinessProfile(token, dto);
  }
}
