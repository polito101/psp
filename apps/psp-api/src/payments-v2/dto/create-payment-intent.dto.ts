import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmptyObject,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const PAYMENT_CHANNELS = ['CASH', 'ONLINE', 'CREDIT_CARD', 'CRYPTO'] as const;
export type PublicPaymentChannel = (typeof PAYMENT_CHANNELS)[number];

class CreatePaymentCustomerAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(256)
  line1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  postcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;
}

export class CreatePaymentCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  uid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  personalId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  lastName!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string;

  @ApiProperty({ example: 'ES' })
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/)
  country!: string;

  @ApiPropertyOptional({ type: CreatePaymentCustomerAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePaymentCustomerAddressDto)
  address?: CreatePaymentCustomerAddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;
}

export class CreatePaymentIntentDto {
  @ApiPropertyOptional({
    description:
      'Legacy: importe en unidades menores (céntimos). Mutuamente excluyente con `amount` decimal (contrato v2).',
    example: 1999,
  })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount == null)
  @IsInt()
  @IsPositive()
  amountMinor?: number;

  @ApiPropertyOptional({
    description: 'Contrato v2: importe decimal en unidad principal de la divisa. Mutuamente excluyente con `amountMinor`.',
    example: 19.99,
  })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amountMinor == null)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  amount?: number;

  @ApiProperty({
    default: 'EUR',
    description:
      'ISO 4217. Con `amountMinor`, unidades menores estándar; con `amount` (v2), el importe decimal usa la misma divisa.',
  })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({
    description:
      'Contrato v2: canal de pago. Obligatorio si se envía `amount` decimal; ignorado con `amountMinor`.',
    enum: PAYMENT_CHANNELS,
  })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsIn(PAYMENT_CHANNELS)
  channel?: PublicPaymentChannel;

  @ApiPropertyOptional({
    description: 'Contrato v2: idioma (p. ej. EN). Obligatorio con `amount`.',
    example: 'EN',
  })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsString()
  @Length(2, 8)
  language?: string;

  @ApiPropertyOptional({ description: 'Contrato v2: pedido del comercio. Obligatorio con `amount`.' })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsString()
  @MaxLength(128)
  orderId?: string;

  @ApiPropertyOptional({ description: 'Contrato v2: descripción. Obligatorio con `amount`.' })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiPropertyOptional({ description: 'Contrato v2: webhook del comercio. Obligatorio con `amount`.' })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  notificationUrl?: string;

  @ApiPropertyOptional({ description: 'Contrato v2: URL de éxito. Obligatorio con `amount`.' })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  returnUrl?: string;

  @ApiPropertyOptional({ description: 'Contrato v2: URL de cancelación. Obligatorio con `amount`.' })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsUrl({ require_tld: false, protocols: ['https', 'http'] })
  @MaxLength(2048)
  cancelUrl?: string;

  @ApiPropertyOptional({
    description:
      'ID de payment link asociado al intent. Con `Idempotency-Key`, debe coincidir exactamente en replays junto con importe/divisa.',
  })
  @IsOptional()
  @IsString()
  paymentLinkId?: string;

  @ApiPropertyOptional({
    description: 'ISO 3166-1 alpha-2 del país del pagador (opcional, reporting). Ignorado en v2 si va `customer.country`.',
    example: 'ES',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/)
  payerCountry?: string;

  @ApiPropertyOptional({
    description:
      'Código de método de pago del catálogo (`mock_card`, `mock_transfer`, …). Por defecto `mock_card`.',
    example: 'mock_card',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethodCode?: string;

  @ApiPropertyOptional({
    type: CreatePaymentCustomerDto,
    description: 'Contrato v2: pagador. Obligatorio si se envía `amount` decimal.',
  })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => CreatePaymentCustomerDto)
  @IsObject()
  customer?: CreatePaymentCustomerDto;
}
