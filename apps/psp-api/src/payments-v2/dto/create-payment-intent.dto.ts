import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmptyObject,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateBy,
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
  @ApiProperty({
    description:
      'Importe decimal en unidad principal de la divisa. Tras conversión a minor no puede superar el límite INTEGER.',
    example: 19.99,
  })
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @IsDecimalAmountWithinPersistableMinor()
  amount!: number;

  @ApiProperty({
    default: 'EUR',
    description: 'ISO 4217. El importe decimal usa la unidad principal de esta divisa.',
  })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({
    description: 'Canal de pago.',
    enum: PAYMENT_CHANNELS,
  })
  @IsIn(PAYMENT_CHANNELS)
  channel!: PublicPaymentChannel;

  @ApiProperty({
    description: 'Idioma (p. ej. EN).',
    example: 'EN',
  })
  @IsString()
  @Length(2, 8)
  language!: string;

  @ApiProperty({ description: 'Pedido del comercio.' })
  @IsString()
  @MaxLength(128)
  orderId!: string;

  @ApiProperty({ description: 'Descripción.' })
  @IsString()
  @MaxLength(512)
  description!: string;

  @ApiProperty({ description: 'Webhook del comercio.' })
  @IsMerchantPaymentCallbackUrl()
  @MaxLength(2048)
  notificationUrl!: string;

  @ApiProperty({ description: 'URL de éxito.' })
  @IsMerchantPaymentCallbackUrl()
  @MaxLength(2048)
  returnUrl!: string;

  @ApiProperty({ description: 'URL de cancelación.' })
  @IsMerchantPaymentCallbackUrl()
  @MaxLength(2048)
  cancelUrl!: string;

  @ApiPropertyOptional({
    description:
      'ID de payment link asociado al intent. Con `Idempotency-Key`, debe coincidir exactamente en replays junto con importe/divisa.',
  })
  @IsOptional()
  @IsString()
  paymentLinkId?: string;

  @ApiPropertyOptional({
    description:
      'Código de método de pago del catálogo (`mock_card`, `mock_transfer`, …). Por defecto `mock_card`.',
    example: 'mock_card',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethodCode?: string;

  @ApiProperty({
    type: CreatePaymentCustomerDto,
    description: 'Datos del pagador.',
  })
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => CreatePaymentCustomerDto)
  @IsObject()
  customer!: CreatePaymentCustomerDto;
}
