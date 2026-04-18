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
@ApiHeader({
  name: 'X-Request-Id',
  required: false,
  description:
    'Opcional. Correlación/traza de la petición. Si no se envía, el servidor genera un UUID y lo devuelve en la misma cabecera de respuesta. Con `X-Correlation-Id` presente, gana `X-Request-Id`.',
})
@ApiHeader({
  name: 'X-Correlation-Id',
  required: false,
  description: 'Opcional. Alias de correlación; se usa solo si falta `X-Request-Id`.',
})
export class PaymentsV2Controller {
  constructor(private readonly payments: PaymentsV2Service) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Crear payment intent (v2 orquestador multi-proveedor)',
    description:
      'El comercio no elige proveedor: el PSP enruta según configuración del servidor (`PAYMENTS_PROVIDER_ORDER`, circuitos, disponibilidad). Stripe en el stack actual es adapter de pruebas y se retirará cuando exista PSP real.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Opcional. Máximo 256 caracteres; charset [A-Za-z0-9._:-]. Cabeceras duplicadas: se usa la primera.',
  })
  createIntent(
    @CurrentMerchant() merchant: { id: string },
    @Body() dto: CreatePaymentIntentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.payments.createIntent(merchant.id, dto, idempotencyKey || undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar payment + attempts' })
  findOne(@CurrentMerchant() merchant: { id: string }, @Param('id') id: string) {
    return this.payments.getPayment(merchant.id, id);
  }

  @Post(':id/capture')
  @ApiOperation({ summary: 'Capturar payment autorizado' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Opcional. Máximo 256 caracteres; charset [A-Za-z0-9._:-]. Cabeceras duplicadas: se usa la primera.',
  })
  capture(
    @CurrentMerchant() merchant: { id: string },
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.payments.capture(merchant.id, id, idempotencyKey || undefined);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancelar payment no liquidado' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Opcional. Máximo 256 caracteres; charset [A-Za-z0-9._:-]. Cabeceras duplicadas: se usa la primera.',
  })
  cancel(
    @CurrentMerchant() merchant: { id: string },
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.payments.cancel(merchant.id, id, idempotencyKey || undefined);
  }

  @Post(':id/refund')
  @ApiOperation({ summary: 'Reembolsar payment liquidado' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Opcional. Máximo 256 caracteres; charset [A-Za-z0-9._:-]. Cabeceras duplicadas: se usa la primera.',
  })
  refund(
    @CurrentMerchant() merchant: { id: string },
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string | string[],
  ) {
    return this.payments.refund(merchant.id, id, dto.amountMinor, idempotencyKey || undefined);
  }
}
