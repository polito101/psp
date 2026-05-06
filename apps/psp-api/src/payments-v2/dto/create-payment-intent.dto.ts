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
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  ValidationOptions,
  type ValidationArguments,
} from 'class-validator';
import {
  PAYMENT_AMOUNT_MINOR_MAX,
  decimalAmountToMinorUnits,
  isPersistablePrismaIntAmountMinor,
} from '../decimal-amount-to-minor';
import { assertStructuralMerchantCallbackUrl } from '../domain/merchant-notification-url.policy';

export function IsMerchantPaymentCallbackUrl(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'IsMerchantPaymentCallbackUrl',
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return true;
          if (typeof value !== 'string') return false;
          try {
            assertStructuralMerchantCallbackUrl(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage: () =>
          'La URL no cumple las políticas de seguridad del PSP (p. ej. HTTPS obligatorio en producción; sin credenciales en la URL; hosts privados o ambiguos rechazados)',
      },
    },
    validationOptions,
  );
}

function IsDecimalAmountWithinPersistableMinor(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isDecimalAmountWithinPersistableMinor',
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value == null || typeof value !== 'number') return true;
          const obj = args.object as CreatePaymentIntentDto;
          if (typeof obj.currency !== 'string' || obj.currency.length === 0) return true;
          if (!Number.isFinite(value)) return false;
          const minor = decimalAmountToMinorUnits(value, obj.currency);
          return isPersistablePrismaIntAmountMinor(minor);
        },
        defaultMessage(args: ValidationArguments) {
          const obj = args.object as CreatePaymentIntentDto;
          const cur = typeof obj.currency === 'string' ? obj.currency.toUpperCase() : '';
          return (
            'amount exceeds maximum for minor-unit storage after conversion ' +
            `(max ${PAYMENT_AMOUNT_MINOR_MAX} minor; currency ${cur || 'n/a'})`
          );
        },
      },
    },
    validationOptions,
  );
}

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
      'Legacy: importe en unidades menores (céntimos). Mutuamente excluyente con `amount` decimal (contrato v2). Máximo por almacenamiento INTEGER.',
    example: 1999,
    maximum: PAYMENT_AMOUNT_MINOR_MAX,
  })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount == null)
  @IsInt()
  @IsPositive()
  @Max(PAYMENT_AMOUNT_MINOR_MAX)
  amountMinor?: number;

  @ApiPropertyOptional({
    description:
      'Contrato v2: importe decimal en unidad principal de la divisa. Mutuamente excluyente con `amountMinor`. Tras conversión a minor no puede superar el límite INTEGER.',
    example: 19.99,
  })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amountMinor == null)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @IsDecimalAmountWithinPersistableMinor()
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
  @IsMerchantPaymentCallbackUrl()
  @MaxLength(2048)
  notificationUrl?: string;

  @ApiPropertyOptional({ description: 'Contrato v2: URL de éxito. Obligatorio con `amount`.' })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsMerchantPaymentCallbackUrl()
  @MaxLength(2048)
  returnUrl?: string;

  @ApiPropertyOptional({ description: 'Contrato v2: URL de cancelación. Obligatorio con `amount`.' })
  @ValidateIf((o: CreatePaymentIntentDto) => o.amount != null)
  @IsMerchantPaymentCallbackUrl()
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
