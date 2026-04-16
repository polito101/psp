import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, IsUrl, Length, Matches, MaxLength } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ example: 1999 })
  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @ApiProperty({ default: 'EUR' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({ description: 'ID de payment link asociado al intent' })
  @IsOptional()
  @IsString()
  paymentLinkId?: string;

  @ApiPropertyOptional({
    description:
      '**Solo pruebas / adapter Stripe provisional.** No forma parte del contrato estable del PSP: desaparecerá al sustituir o retirar Stripe. Stripe PaymentMethod (`pm_...`). Si se envía, el intent se crea con `confirm=true` en servidor (captura manual). Para métodos con redirect suele hacer falta `stripeReturnUrl`.',
    example: 'pm_card_visa',
  })
  @IsOptional()
  @IsString()
  @Matches(/^pm_[A-Za-z0-9_]+$/, { message: 'stripePaymentMethodId must be a Stripe PaymentMethod id (pm_...)' })
  stripePaymentMethodId?: string;

  @ApiPropertyOptional({
    description:
      '**Solo pruebas / adapter Stripe provisional.** No forma parte del contrato estable del PSP: desaparecerá al sustituir o retirar Stripe. URL de retorno (p. ej. tras 3DS redirect) cuando se confirma en servidor con `stripePaymentMethodId`.',
    example: 'https://example.com/pay/return',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  stripeReturnUrl?: string;
}
