import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PatchMerchantPaymentMethodDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  merchantEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  adminEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  minAmountMinor?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  maxAmountMinor?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  visibleToMerchant?: boolean;

  @ApiPropertyOptional({ description: 'Actor para auditoría (p. ej. admin:uid)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  lastChangedBy?: string;
}
