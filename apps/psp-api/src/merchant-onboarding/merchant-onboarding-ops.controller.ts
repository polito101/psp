import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { ListMerchantOnboardingApplicationsQueryDto } from './dto/list-merchant-onboarding-applications-query.dto';
import { RejectMerchantOnboardingDto } from './dto/reject-merchant-onboarding.dto';
import { MerchantOnboardingService } from './merchant-onboarding.service';

@ApiTags('merchant-onboarding-ops')
@ApiSecurity('InternalSecret')
@UseGuards(InternalSecretGuard)
@Controller({ path: 'merchant-onboarding/ops', version: '1' })
export class MerchantOnboardingOpsController {
  constructor(private readonly service: MerchantOnboardingService) {}

  @Get('applications')
  @ApiOperation({ summary: 'Listar expedientes onboarding merchant (interno)' })
  listApplications(@Query() query: ListMerchantOnboardingApplicationsQueryDto) {
    return this.service.listApplications(query);
  }

  @Get('applications/:applicationId')
  @ApiOperation({ summary: 'Detalle de expediente onboarding merchant (interno)' })
  getApplication(@Param('applicationId') applicationId: string) {
    return this.service.getApplication(applicationId);
  }

  @Post('applications/:applicationId/approve')
  @ApiOperation({ summary: 'Aprobar expediente y activar merchant (interno)' })
  approve(@Param('applicationId') applicationId: string) {
    return this.service.approveApplication(applicationId);
  }

  @Post('applications/:applicationId/reject')
  @ApiOperation({ summary: 'Rechazar expediente onboarding merchant (interno)' })
  reject(@Param('applicationId') applicationId: string, @Body() dto: RejectMerchantOnboardingDto) {
    return this.service.rejectApplication(applicationId, dto);
  }

  @Post('applications/:applicationId/resend-link')
  @ApiOperation({ summary: 'Reenviar link de onboarding (interno)' })
  resendLink(@Param('applicationId') applicationId: string) {
    return this.service.resendLink(applicationId);
  }
}
