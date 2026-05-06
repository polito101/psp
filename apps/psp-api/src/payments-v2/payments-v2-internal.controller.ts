import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  InternalSecretGuard,
  readBackofficeMerchantScopeId,
} from '../common/guards/internal-secret.guard';
import type { Request } from 'express';
import { ListOpsTransactionsDto } from './dto/list-ops-transactions.dto';
import { OpsMerchantFinancePayoutsQueryDto } from './dto/ops-merchant-finance-payouts-query.dto';
import { OpsMerchantFinanceSummaryQueryDto } from './dto/ops-merchant-finance-summary-query.dto';
import { OpsMerchantFinanceTransactionsQueryDto } from './dto/ops-merchant-finance-transactions-query.dto';
import { OpsPaymentDetailQueryDto } from './dto/ops-payment-detail-query.dto';
import { OpsPaymentsSummaryQueryDto } from './dto/ops-payments-summary-query.dto';
import { OpsTransactionCountsQueryDto } from './dto/ops-transaction-counts-query.dto';
import { OpsVolumeHourlyQueryDto } from './dto/ops-volume-hourly-query.dto';
import { OpsDashboardVolumeUsdQueryDto } from './dto/ops-dashboard-volume-usd-query.dto';
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

  @Get('ops/transactions/summary')
  @ApiOperation({
    summary:
      'Agregados ops para dos ventanas (created_at): total pagos, volumen bruto, volumen neto (quote), errores failed+canceled',
  })
  async paymentsSummary(@Query() query: OpsPaymentsSummaryQueryDto) {
    return this.payments.getOpsPaymentsSummary(query);
  }

  @Get('ops/transactions/summary-daily')
  @ApiOperation({
    summary:
      'Series diarias UTC (agregados por día) para dos ventanas: payments, bruto, neto, errores failed+canceled (mismos filtros que summary)',
  })
  async paymentsSummaryDaily(@Query() query: OpsPaymentsSummaryQueryDto) {
    return this.payments.getOpsPaymentsSummaryDaily(query);
  }

  @Get('ops/transactions/summary-hourly')
  @ApiOperation({
    summary:
      'Series horarias UTC (24 buckets por hora 0–23) para dos ventanas de exactamente un día calendario UTC cada una: payments, bruto, neto, errores failed+canceled',
  })
  async paymentsSummaryHourly(@Query() query: OpsPaymentsSummaryQueryDto) {
    return this.payments.getOpsPaymentsSummaryHourly(query);
  }

  @Get('ops/transactions/volume-hourly')
  @ApiOperation({
    summary:
      'Serie horaria UTC acumulada de pagos succeeded: día actual (UTC) frente al calendario `compareUtcDate` (YYYY-MM-DD; por defecto ayer UTC), horas 0–23. Métricas: `volume_gross`, `volume_net`, `succeeded_count` (ver query `metric`). Valores de serie como strings en JSON.',
  })
  @ApiQuery({
    name: 'metric',
    required: false,
    description:
      'Métrica por hora. `volume_gross` (default): suma `amount_minor`. `volume_net`: suma `PaymentFeeQuote.net_minor` con fallback a `amount_minor`. `succeeded_count`: recuento de pagos succeeded.',
    schema: {
      type: 'string',
      enum: ['volume_gross', 'volume_net', 'succeeded_count'],
      default: 'volume_gross',
    },
  })
  @ApiQuery({
    name: 'compareUtcDate',
    required: false,
    description:
      'Día calendario UTC de comparación (YYYY-MM-DD). Debe ser una fecha válida, estrictamente anterior al día actual en UTC, y no anterior a hoy UTC menos 730 días. Si se omite, ayer UTC.',
    schema: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      example: '2026-04-23',
    },
  })
  async volumeHourly(@Query() query: OpsVolumeHourlyQueryDto) {
    return this.payments.getOpsVolumeHourlySeries(query);
  }

  @Get('ops/dashboard/volume-usd')
  @ApiOperation({
    summary:
      'Volumen agregado (paid/pending/failed) convertido a USD minor con snapshots FX; mismos filtros base que listado ops',
  })
  async dashboardVolumeUsd(@Query() query: OpsDashboardVolumeUsdQueryDto) {
    return this.payments.getOpsDashboardVolumeUsd(query);
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

  @Get('ops/payments/:paymentId/action')
  @ApiOperation({
    summary: 'Acción persistida del pago (solo lectura desde `actionSnapshot`); no llama al proveedor',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'ID interno del pago (`Payment.id`)',
    schema: { type: 'string', maxLength: 64 },
  })
  async getOpsPaymentAction(@Param('paymentId') paymentId: string, @Req() req: Request) {
    const id = paymentId?.trim();
    if (!id || id.length > 64) {
      throw new BadRequestException('Invalid paymentId');
    }
    const backofficeMerchantScopeId = readBackofficeMerchantScopeId(req);
    return this.payments.getOpsPaymentAction(id, { backofficeMerchantScopeId });
  }

  @Post('ops/payments/:paymentId/notifications/:deliveryId/resend')
  @ApiOperation({
    summary: 'Reenvía la notificación al comercio a partir de una entrega previa (cuerpo enmascarado)',
  })
  @ApiParam({
    name: 'paymentId',
    description: 'ID interno del pago (`Payment.id`)',
    schema: { type: 'string', maxLength: 64 },
  })
  @ApiParam({
    name: 'deliveryId',
    description: 'ID de `PaymentNotificationDelivery`',
    schema: { type: 'string', maxLength: 64 },
  })
  async resendPaymentNotification(
    @Param('paymentId') paymentId: string,
    @Param('deliveryId') deliveryId: string,
    @Req() req: Request,
  ) {
    const pid = paymentId?.trim();
    const did = deliveryId?.trim();
    if (!pid || pid.length > 64) {
      throw new BadRequestException('Invalid paymentId');
    }
    if (!did || did.length > 64) {
      throw new BadRequestException('Invalid deliveryId');
    }
    const backofficeMerchantScopeId = readBackofficeMerchantScopeId(req);
    return this.payments.resendPaymentNotificationDelivery(pid, did, { backofficeMerchantScopeId });
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
  async getOpsPayment(
    @Param('paymentId') paymentId: string,
    @Query() query: OpsPaymentDetailQueryDto,
    @Req() req: Request,
  ) {
    const id = paymentId?.trim();
    if (!id || id.length > 64) {
      throw new BadRequestException('Invalid paymentId');
    }
    const backofficeMerchantScopeId = readBackofficeMerchantScopeId(req);
    return this.payments.getOpsPaymentDetail(id, {
      includePayload: query.includePayload === true,
      backofficeMerchantScopeId,
    });
  }
}
