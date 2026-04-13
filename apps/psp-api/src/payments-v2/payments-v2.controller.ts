import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentMerchant } from '../common/decorators/merchant.decorator';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentsV2Service } from './payments-v2.service';

@ApiTags('payments-v2')
@Controller({ path: 'payments', version: '2' })
@UseGuards(ApiKeyGuard)
@ApiSecurity('ApiKey')
export class PaymentsV2Controller {
  constructor(private readonly payments: PaymentsV2Service) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Crear payment intent (v2 orquestador multi-proveedor)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Clave idempotente de creación de intent.',
  })
  createIntent(
    @CurrentMerchant() merchant: { id: string },
    @Body() dto: CreatePaymentIntentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.createIntent(merchant.id, dto, idempotencyKey || undefined);
  }

  @Get('ops/metrics')
  @ApiOperation({ summary: 'Snapshot de métricas operativas por proveedor (v2)' })
  metrics() {
    return this.payments.getMetricsSnapshot();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar payment + attempts' })
  findOne(@CurrentMerchant() merchant: { id: string }, @Param('id') id: string) {
    return this.payments.getPayment(merchant.id, id);
  }

  @Post(':id/capture')
  @ApiOperation({ summary: 'Capturar payment autorizado' })
  capture(@CurrentMerchant() merchant: { id: string }, @Param('id') id: string) {
    return this.payments.capture(merchant.id, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar payment no liquidado' })
  cancel(@CurrentMerchant() merchant: { id: string }, @Param('id') id: string) {
    return this.payments.cancel(merchant.id, id);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Reembolsar payment liquidado' })
  refund(
    @CurrentMerchant() merchant: { id: string },
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.payments.refund(merchant.id, id, dto.amountMinor);
  }
}
