import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES } from '../../payments-v2/domain/payment-provider-names';

const SETTLEMENT_MODES = ['NET', 'GROSS'] as const;
const PAYOUT_SCHEDULE_TYPES = ['T_PLUS_N', 'WEEKLY'] as const;

export class CreateRateTableDto {
  @ApiProperty({
    description: 'Proveedor PSP al que aplica la tarifa',
    enum: PAYMENT_PROVIDER_NAMES,
    example: 'stripe',
  })
  @IsString()
  @IsIn(PAYMENT_PROVIDER_NAMES)
  provider!: (typeof PAYMENT_PROVIDER_NAMES)[number];

  @ApiProperty({ description: 'Divisa ISO 4217', example: 'EUR' })
  @IsString()
  @MinLength(3)
  currency!: string;

  @ApiProperty({ description: 'Comisión porcentual en basis points', example: 150 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  percentageBps!: number;

  @ApiProperty({ description: 'Comisión fija por transacción en minor units', example: 25 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fixedMinor!: number;

  @ApiProperty({ description: 'Comisión mínima en minor units', example: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumMinor!: number;

  @ApiProperty({ description: 'Modo de liquidación', enum: SETTLEMENT_MODES, example: 'NET' })
  @IsString()
  @IsIn(SETTLEMENT_MODES)
  settlementMode!: (typeof SETTLEMENT_MODES)[number];

  @ApiProperty({
    description: 'Tipo de calendario de payouts',
    enum: PAYOUT_SCHEDULE_TYPES,
    example: 'T_PLUS_N',
  })
  @IsString()
  @IsIn(PAYOUT_SCHEDULE_TYPES)
  payoutScheduleType!: (typeof PAYOUT_SCHEDULE_TYPES)[number];

  @ApiProperty({
    description: 'Parámetro del calendario (días para T+N; day index 0-6 para semanal)',
    example: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  payoutScheduleParam!: number;

  @ApiPropertyOptional({
    description: 'Referencia opcional al contrato comercial firmado',
    example: 'contract-2026-merchant-a-stripe',
  })
  @IsOptional()
  @IsString()
  contractRef?: string;
}
