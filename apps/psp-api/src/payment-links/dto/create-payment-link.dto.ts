import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, IsPositive, IsString, Length, Min } from 'class-validator';

export class CreatePaymentLinkDto {
  @ApiProperty({ description: 'Importe en unidades menores (céntimos)', example: 1999 })
  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @ApiPropertyOptional({ default: 'EUR' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ description: 'Segundos hasta expiración (opcional)' })
  @IsOptional()
  @IsInt()
  @Min(60)
  ttlSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
