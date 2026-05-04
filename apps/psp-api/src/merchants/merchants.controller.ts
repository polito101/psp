import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PatchMerchantAccountDto } from './dto/patch-merchant-account.dto';
import { PatchMerchantActiveDto } from './dto/patch-merchant-active.dto';
import { PatchMerchantPaymentMethodDto } from './dto/patch-merchant-payment-method.dto';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { CreateRateTableDto } from './dto/create-rate-table.dto';
import { MerchantsService } from './merchants.service';

class RotateKeyDto {
  @ApiPropertyOptional({
    description: 'Días de validez de la nueva key (1-3650). Sin valor, no expira.',
    example: 90,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  keyTtlDays?: number;
}

class MerchantIdParam {
  @ApiProperty({ description: 'ID del merchant', example: 'clxxx...' })
  @IsString()
  id!: string;
}

@ApiTags('merchants')
@Controller({ path: 'merchants', version: '1' })
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get('ops/directory')
  @ApiOperation({ summary: 'Directorio de merchants (interno, admin)' })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  opsDirectory() {
    return this.merchants.listOpsDirectory();
  }

  @Get('ops/:id/detail')
  @ApiOperation({ summary: 'Detalle operativo merchant + actividad reciente (interno)' })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  opsDetail(@Param('id') id: string) {
    return this.merchants.getOpsDetail(id);
  }

  @Patch('ops/:id/active')
  @ApiOperation({ summary: 'Activar/desactivar merchant (interno)' })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiBody({ type: PatchMerchantActiveDto })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  opsSetActive(@Param('id') id: string, @Body() body: PatchMerchantActiveDto) {
    return this.merchants.setMerchantActive(id, body.isActive);
  }

  @Patch('ops/:id/account')
  @ApiOperation({ summary: 'Actualizar cuenta administrativa del merchant (interno admin)' })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiBody({ type: PatchMerchantAccountDto })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  opsPatchAccount(@Param('id') id: string, @Body() body: PatchMerchantAccountDto) {
    return this.merchants.patchMerchantAccount(id, body);
  }

  @Get('ops/:id/payment-methods')
  @ApiOperation({ summary: 'Métodos de pago configurados del merchant (interno)' })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  opsListPaymentMethods(@Param('id') id: string) {
    return this.merchants.listMerchantPaymentMethods(id);
  }

  @Patch('ops/:id/payment-methods/:mpmId')
  @ApiOperation({ summary: 'Actualizar método de pago del merchant (kill switch / límites) (interno)' })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiParam({ name: 'mpmId', description: 'ID de MerchantPaymentMethod' })
  @ApiBody({ type: PatchMerchantPaymentMethodDto })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  opsPatchPaymentMethod(
    @Param('id') merchantId: string,
    @Param('mpmId') mpmId: string,
    @Body() body: PatchMerchantPaymentMethodDto,
  ) {
    return this.merchants.patchMerchantPaymentMethod(merchantId, mpmId, body);
  }

  @Post()
  @ApiOperation({ summary: 'Crear comercio (solo bootstrap; requiere X-Internal-Secret)' })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  create(@Body() dto: CreateMerchantDto) {
    return this.merchants.create(dto);
  }

  @Post(':id/rotate-key')
  @ApiOperation({
    summary: 'Rotar API key del merchant (requiere X-Internal-Secret)',
    description:
      'Genera una nueva API key e invalida la anterior inmediatamente. ' +
      'Devuelve la nueva key en texto plano; no se volverá a mostrar.',
  })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiBody({ type: RotateKeyDto, required: false })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  rotateKey(@Param() params: MerchantIdParam, @Body() dto: RotateKeyDto) {
    return this.merchants.rotateApiKey(params.id, dto.keyTtlDays);
  }

  @Post(':id/revoke-key')
  @ApiOperation({
    summary: 'Revocar API key del merchant (requiere X-Internal-Secret)',
    description:
      'Invalida la API key activa de forma inmediata. ' +
      'Usa rotate-key para emitir una nueva key.',
  })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  revokeKey(@Param() params: MerchantIdParam) {
    return this.merchants.revokeApiKey(params.id);
  }

  @Post(':id/rate-tables')
  @ApiOperation({
    summary: 'Crear/actualizar tarifa vigente por merchant+currency+provider (requiere X-Internal-Secret)',
  })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiBody({ type: CreateRateTableDto })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  createRateTable(@Param() params: MerchantIdParam, @Body() dto: CreateRateTableDto) {
    return this.merchants.createRateTable(params.id, dto);
  }

  @Get(':id/rate-tables')
  @ApiOperation({
    summary: 'Listar histórico de tarifas del merchant (requiere X-Internal-Secret)',
  })
  @ApiParam({ name: 'id', description: 'ID del merchant' })
  @ApiSecurity('InternalSecret')
  @UseGuards(InternalSecretGuard)
  listRateTables(@Param() params: MerchantIdParam) {
    return this.merchants.listRateTables(params.id);
  }
}
