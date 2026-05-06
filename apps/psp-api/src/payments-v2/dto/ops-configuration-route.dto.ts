import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

const CHANNELS = ['CASH', 'ONLINE', 'CREDIT_CARD', 'CRYPTO'] as const;
const MODES = ['S2S', 'REDIRECTION', 'HOSTED_PAGE'] as const;
const TEMPLATES = ['REDIRECT_SIMPLE', 'SPEI_BANK_TRANSFER'] as const;

/** Alineado con `PaymentMethodRouteCurrency` Prisma `@db.Decimal(18, 6)`. */
export const OPS_CONFIGURATION_ROUTE_CURRENCY_AMOUNT_MAX = 999_999_999_999.999999;

function toUpperIfString({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

@ValidatorConstraint({ name: 'OpsConfigurationRouteCurrencyMinLteMax', async: false })
class OpsConfigurationRouteCurrencyMinLteMaxConstraint implements ValidatorConstraintInterface {
  validate(maxAmount: unknown, args: ValidationArguments): boolean {
    const obj = args.object as OpsConfigurationRouteCurrencyDto;
    const min = obj.minAmount;
    if (typeof min !== 'number' || typeof maxAmount !== 'number') {
      return true;
    }
    if (!Number.isFinite(min) || !Number.isFinite(maxAmount)) {
      return false;
    }
    return min <= maxAmount;
  }

  defaultMessage(): string {
    return 'minAmount must be less than or equal to maxAmount';
  }
}

export class OpsConfigurationRouteCurrencyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @ApiProperty({
    description: 'Importe mínimo (Decimal 18,6 en persistencia).',
    minimum: 0,
    maximum: OPS_CONFIGURATION_ROUTE_CURRENCY_AMOUNT_MAX,
  })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @Min(0)
  @Max(OPS_CONFIGURATION_ROUTE_CURRENCY_AMOUNT_MAX)
  minAmount!: number;

  @ApiProperty({
    description: 'Importe máximo (Decimal 18,6 en persistencia).',
    minimum: 0,
    maximum: OPS_CONFIGURATION_ROUTE_CURRENCY_AMOUNT_MAX,
  })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 })
  @Min(0)
  @Max(OPS_CONFIGURATION_ROUTE_CURRENCY_AMOUNT_MAX)
  @Validate(OpsConfigurationRouteCurrencyMinLteMaxConstraint)
  maxAmount!: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateOpsConfigurationRouteDto {
  @IsString()
  @MinLength(1)
  providerId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  methodCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  methodName!: string;

  @IsString()
  @Length(2, 2)
  @Transform(toUpperIfString)
  countryCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryImageName?: string;

  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @IsIn(MODES)
  integrationMode!: (typeof MODES)[number];

  @IsIn(TEMPLATES)
  requestTemplate!: (typeof TEMPLATES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  integrationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  checkoutUrlTemplate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expirationTimeOffset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  weight?: number;

  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  isPublished?: boolean;

  @IsOptional()
  @IsObject()
  routeConfigJson?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpsConfigurationRouteCurrencyDto)
  currencies!: OpsConfigurationRouteCurrencyDto[];
}

export class PatchOpsConfigurationRouteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  methodCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  methodName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(toUpperIfString)
  countryCode?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  countryImageName?: string | null;

  @IsOptional()
  @IsIn(CHANNELS)
  channel?: (typeof CHANNELS)[number];

  @IsOptional()
  @IsIn(MODES)
  integrationMode?: (typeof MODES)[number];

  @IsOptional()
  @IsIn(TEMPLATES)
  requestTemplate?: (typeof TEMPLATES)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  integrationCode?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  checkoutUrlTemplate?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expirationTimeOffset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  weight?: number;

  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  isPublished?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'JSON de configuración adicional de la ruta' })
  @IsOptional()
  @IsObject()
  routeConfigJson?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Monedas de la ruta. Un array vacío (`[]`) o `null` elimina todas las monedas asociadas.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpsConfigurationRouteCurrencyDto)
  currencies?: OpsConfigurationRouteCurrencyDto[] | null;
}

export class PatchOpsConfigurationRouteWeightDto {
  @Type(() => Number)
  @IsInt()
  weight!: number;
}
