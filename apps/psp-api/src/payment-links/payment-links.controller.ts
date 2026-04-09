import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentMerchant } from '../common/decorators/merchant.decorator';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentLinksService } from './payment-links.service';

@ApiTags('payment-links')
@Controller({ path: 'payment-links', version: '1' })
@UseGuards(ApiKeyGuard)
@ApiSecurity('ApiKey')
export class PaymentLinksController {
  constructor(private readonly links: PaymentLinksService) {}

  @Post()
  @ApiOperation({ summary: 'Crear enlace de pago (Pay-by-link)' })
  create(
    @CurrentMerchant() merchant: { id: string },
    @Body() dto: CreatePaymentLinkDto,
    @Req() req: Request,
  ) {
    const publicBaseUrl = `${req.protocol}://${req.get('host')}`;
    return this.links.create(merchant.id, dto, publicBaseUrl);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un payment link' })
  findOne(@CurrentMerchant() merchant: { id: string }, @Param('id') id: string) {
    return this.links.findForMerchant(merchant.id, id);
  }
}
