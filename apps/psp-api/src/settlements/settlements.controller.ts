import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { CreateSettlementRequestDto } from './dto/create-settlement-request.dto';
import { ReviewSettlementRequestDto } from './dto/review-settlement-request.dto';
import { SettlementRequestsService } from './settlement-requests.service';
import { SettlementRequestStatus } from '../generated/prisma/enums';
import type { Request } from 'express';

@ApiTags('settlements')
@Controller({ path: 'settlements', version: '1' })
@ApiSecurity('InternalSecret')
@UseGuards(InternalSecretGuard)
export class SettlementsController {
  constructor(private readonly requests: SettlementRequestsService) {}

  @Get('merchants/:merchantId/available-balance')
  @ApiOperation({ summary: 'Saldo neto AVAILABLE sin payout (interno)' })
  @ApiParam({ name: 'merchantId' })
  async availableBalance(
    @Param('merchantId') merchantId: string,
    @Query('currency') currency = 'EUR',
  ) {
    return this.requests.getAvailableNetMinor(merchantId, currency);
  }

  @Post('merchants/:merchantId/requests')
  @ApiOperation({ summary: 'Crear solicitud de settlement (interno)' })
  @ApiParam({ name: 'merchantId' })
  async createRequest(
    @Param('merchantId') merchantId: string,
    @Query('currency') currency: string | undefined,
    @Body() body: CreateSettlementRequestDto,
    @Req() req: Request,
  ) {
    const role = String(req.headers['x-backoffice-role'] ?? '').toLowerCase();
    const requestedByRole = role === 'merchant' ? 'merchant' : 'admin';
    const cur = (currency ?? 'EUR').toUpperCase();
    return this.requests.createRequest({
      merchantId,
      currency: cur,
      notes: body.notes,
      requestedByRole,
    });
  }

  @Get('merchants/:merchantId/requests')
  @ApiOperation({ summary: 'Historial de solicitudes de settlement del merchant (interno)' })
  @ApiParam({ name: 'merchantId' })
  async listMerchantRequests(@Param('merchantId') merchantId: string) {
    return { items: await this.requests.listForMerchant(merchantId) };
  }

  @Get('requests/inbox')
  @ApiOperation({ summary: 'Bandeja admin de solicitudes (interno)' })
  async inbox(@Query('status') status?: SettlementRequestStatus) {
    const st = status ?? SettlementRequestStatus.PENDING;
    return { items: await this.requests.listInbox(st) };
  }

  @Post('requests/:id/approve')
  @ApiOperation({ summary: 'Aprobar solicitud y ejecutar payout (interno, admin)' })
  @ApiParam({ name: 'id' })
  async approve(@Param('id') id: string, @Body() body: ReviewSettlementRequestDto) {
    return this.requests.approve(id, body.reviewedNotes);
  }

  @Post('requests/:id/reject')
  @ApiOperation({ summary: 'Rechazar solicitud (interno, admin)' })
  @ApiParam({ name: 'id' })
  async reject(@Param('id') id: string, @Body() body: ReviewSettlementRequestDto) {
    return this.requests.reject(id, body.reviewedNotes);
  }
}
