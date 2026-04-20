import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { ListOpsTransactionsDto } from './dto/list-ops-transactions.dto';
import { OpsMerchantFinancePayoutsQueryDto } from './dto/ops-merchant-finance-payouts-query.dto';
import { OpsMerchantFinanceSummaryQueryDto } from './dto/ops-merchant-finance-summary-query.dto';
import { OpsMerchantFinanceTransactionsQueryDto } from './dto/ops-merchant-finance-transactions-query.dto';
import { OpsPaymentDetailQueryDto } from './dto/ops-payment-detail-query.dto';
import { OpsTransactionCountsQueryDto } from './dto/ops-transaction-counts-query.dto';
import { OpsVolumeHourlyQueryDto } from './dto/ops-volume-hourly-query.dto';
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

  @Get('ops/transactions/counts')
  @ApiOperation({
    summary:
      'Conteos por estado en una sola respuesta (groupBy) con los mismos filtros base que el listado ops (sin filtro por status)',
  })
  async transactionCounts(@Query() query: OpsTransactionCountsQueryDto) {
    return this.payments.getOpsTransactionCounts(query);
  }

  @Get('ops/transactions/volume-hourly')
  @ApiOperation({
    summary:
      'Serie horaria UTC de volumen acumulado (amount_minor) de pagos succeeded: hoy vs ayer, por hora 0–23',
  })
  async volumeHourly(@Query() query: OpsVolumeHourlyQueryDto) {
    return this.payments.getOpsVolumeHourlySeries(query);
  }

  @Get('ops/transactions')
  @ApiOperation({
    summary: 'Listado operativo interno de transacciones con último intento de proveedor',
  })
  @ApiQuery({
    name: 'direction',
    required: false,
    description: 'Dirección de paginación por cursor. next=items más viejos, prev=items más nuevos. Default: next.',
    schema: { type: 'string', enum: ['next', 'prev'], default: 'next' },
  })
  @ApiQuery({
    name: 'cursorCreatedAt',
    required: false,
    description: 'Cursor (createdAt ISO) del boundary item. Debe venir junto con cursorId.',
    schema: { type: 'string', format: 'date-time' },
  })
  @ApiQuery({
    name: 'cursorId',
    required: false,
    description: 'Cursor (id) del boundary item. Debe venir junto con cursorCreatedAt.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'includeTotal',
    required: false,
    description:
      'Si es false, omite el COUNT global; total y totalPages serán null (útil para polling). Por defecto true.',
    schema: { type: 'boolean', default: true },
  })
  async listTransactions(@Query() query: ListOpsTransactionsDto) {
    return this.payments.listOpsTransactions(query);
  }

  @Get('ops/merchants/:merchantId/finance/summary')
  @ApiOperation({
    summary: 'Resumen financiero por merchant: totales gross/fee/net (minor units)',
  })
  async merchantFinanceSummary(
    @Param('merchantId') merchantId: string,
    @Query() query: OpsMerchantFinanceSummaryQueryDto,
  ) {
    return this.payments.getOpsMerchantFinanceSummary(merchantId, query);
  }

  @Get('ops/merchants/:merchantId/finance/transactions')
  @ApiOperation({
    summary: 'Listado financiero por merchant con gross/fee/net por transacción',
  })
  async merchantFinanceTransactions(
    @Param('merchantId') merchantId: string,
    @Query() query: OpsMerchantFinanceTransactionsQueryDto,
  ) {
    return this.payments.listOpsMerchantFinanceTransactions(merchantId, query);
  }

  @Get('ops/merchants/:merchantId/finance/payouts')
  @ApiOperation({
    summary: 'Listado de payouts por merchant (filtros por estado/divisa/rango)',
  })
  async merchantFinancePayouts(
    @Param('merchantId') merchantId: string,
    @Query() query: OpsMerchantFinancePayoutsQueryDto,
  ) {
    return this.payments.listOpsMerchantFinancePayouts(merchantId, query);
  }

  @Get('ops/payments/:paymentId')
  @ApiOperation({
    summary:
      'Detalle operativo interno de un pago con PaymentAttempt (hasta 200 más recientes, orden cronológico; `attemptsTotal`/`attemptsTruncated` si hay más)',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'ID interno del pago (`Payment.id`)',
    schema: { type: 'string', maxLength: 64 },
  })
  @ApiQuery({
    name: 'includePayload',
    required: false,
    description:
      'Si es true, cada intento incluye `responsePayload` (respuesta cruda de proveedor; solo depuración). Por defecto omitido.',
    schema: { type: 'boolean', default: false },
  })
  async getOpsPayment(@Param('paymentId') paymentId: string, @Query() query: OpsPaymentDetailQueryDto) {
    const id = paymentId?.trim();
    if (!id || id.length > 64) {
      throw new BadRequestException('Invalid paymentId');
    }
    return this.payments.getOpsPaymentDetail(id, { includePayload: query.includePayload === true });
  }
}
