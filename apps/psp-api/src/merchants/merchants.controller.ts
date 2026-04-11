import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { CreateMerchantDto } from './dto/create-merchant.dto';
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
  id!: string;
}

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
}
