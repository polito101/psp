import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { MerchantsService } from './merchants.service';

@ApiTags('merchants')
@Controller({ path: 'merchants', version: '1' })
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear comercio (solo bootstrap; requiere X-Internal-Secret)' })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  create(@Body() dto: CreateMerchantDto) {
    return this.merchants.create(dto);
  }
}
