import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { PaymentsV2Service } from './payments-v2.service';

@ApiTags('payments-v2')
@Controller({ path: 'payments', version: '2' })
@ApiSecurity('InternalSecret')
@UseGuards(InternalSecretGuard)
export class PaymentsV2InternalController {
  constructor(private readonly payments: PaymentsV2Service) {}

  @Get('ops/metrics')
  @ApiOperation({
    summary: 'Snapshot interno de métricas operativas (payments, circuit breakers y cola webhooks)',
  })
  async metrics() {
    return this.payments.getMetricsSnapshot();
  }
}
