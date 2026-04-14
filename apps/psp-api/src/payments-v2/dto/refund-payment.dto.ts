import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({
    description: 'Reembolso parcial en unidades menores. Si se omite, reembolso total.',
    example: 500,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountMinor?: number;
}
