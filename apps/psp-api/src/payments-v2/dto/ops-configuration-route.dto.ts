import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const CHANNELS = ['CASH', 'ONLINE', 'CREDIT_CARD', 'CRYPTO'] as const;
const MODES = ['S2S', 'REDIRECTION', 'HOSTED_PAGE'] as const;
const TEMPLATES = ['REDIRECT_SIMPLE', 'SPEI_BANK_TRANSFER'] as const;

function toUpperIfString({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

export class OpsConfigurationRouteCurrencyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency!: string;

  @Type(() => Number)
  minAmount!: number;

  @Type(() => Number)
  maxAmount!: number;

  @IsOptional()
  @Type(() => Boolean)
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpsConfigurationRouteCurrencyDto)
  currencies?: OpsConfigurationRouteCurrencyDto[];
}

export class PatchOpsConfigurationRouteWeightDto {
  @Type(() => Number)
  @IsInt()
  weight!: number;
}
