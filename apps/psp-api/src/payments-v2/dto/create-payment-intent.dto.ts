import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, Length } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ example: 1999 })
  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @ApiProperty({
    default: 'EUR',
    description:
      'ISO 4217 (3 letras). Debe existir una MerchantRateTable activa para esta divisa y al menos un proveedor del orden de ruteo; si no, create intent responde 409.',
  })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({
    description:
      'ID de payment link asociado al intent. Con `Idempotency-Key`, debe coincidir exactamente en replays junto con importe/divisa.',
  })
  @IsOptional()
  @IsString()
  paymentLinkId?: string;
}
