import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { ListOpsTransactionsDto } from './dto/list-ops-transactions.dto';
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

  @Get('ops/transactions')
  @ApiOperation({
    summary: 'Listado operativo interno de transacciones con último intento de proveedor',
  })
  async listTransactions(@Query() query: ListOpsTransactionsDto) {
    return this.payments.listOpsTransactions(query);
  }
}
