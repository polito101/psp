import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, IsUrl, Length, Matches, MaxLength } from 'class-validator';

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
      'ID de payment link asociado al intent. Con `Idempotency-Key`, debe coincidir exactamente en replays junto con importe/divisa y los campos Stripe opcionales de abajo.',
  })
  @IsOptional()
  @IsString()
  paymentLinkId?: string;

  @ApiPropertyOptional({
    description:
      '**Solo pruebas / adapter Stripe provisional.** No forma parte del contrato estable del PSP: desaparecerá al sustituir o retirar Stripe. Stripe PaymentMethod (`pm_...`). Si se envía, el intent se crea con `confirm=true` en servidor (captura manual). Para métodos con redirect suele hacer falta `stripeReturnUrl`. Con `Idempotency-Key`, un replay con otro `pm_...` debe recibir 409.',
    example: 'pm_card_visa',
  })
  @IsOptional()
  @IsString()
  @Matches(/^pm_[A-Za-z0-9_]+$/, { message: 'stripePaymentMethodId must be a Stripe PaymentMethod id (pm_...)' })
  stripePaymentMethodId?: string;

  @ApiPropertyOptional({
    description:
      '**Solo pruebas / adapter Stripe provisional.** No forma parte del contrato estable del PSP: desaparecerá al sustituir o retirar Stripe. URL de retorno (p. ej. tras 3DS redirect) cuando se confirma en servidor con `stripePaymentMethodId`. Con `Idempotency-Key`, un replay con otra URL debe recibir 409.',
    example: 'https://example.com/pay/return',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  stripeReturnUrl?: string;
}
