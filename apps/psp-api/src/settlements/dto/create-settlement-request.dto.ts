import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSettlementRequestDto {
  @ApiPropertyOptional({ description: 'Notas opcionales del solicitante' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
