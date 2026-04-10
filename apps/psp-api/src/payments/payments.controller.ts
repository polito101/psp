import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentMerchant } from '../common/decorators/merchant.decorator';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller({ path: 'payments', version: '1' })
@UseGuards(ApiKeyGuard)
@ApiSecurity('ApiKey')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Crear pago (pendiente); usar capture para sandbox fiat' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Opcional. Reutiliza la misma clave solo para reintentos del mismo pago.',
  })
  create(
    @CurrentMerchant() merchant: { id: string },
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.create(merchant.id, {
      ...dto,
      idempotencyKey: idempotencyKey || undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Estado del pago' })
  findOne(@CurrentMerchant() merchant: { id: string }, @Param('id') id: string) {
    return this.payments.findOne(merchant.id, id);
  }

  @Post(':id/capture')
  @ApiOperation({
    summary: 'Capturar pago (simula adquirente sandbox / tokenización ya completada)',
  })
  capture(@CurrentMerchant() merchant: { id: string }, @Param('id') id: string) {
    return this.payments.capture(merchant.id, id);
  }
}
