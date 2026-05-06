import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertOpsConfigurationMerchantRateDto {
  @IsString()
  @MinLength(1)
  providerId!: string;

  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  countryCode!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fixed!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRateDiscount?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  applyToCustomer?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  fxSpread?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  fxMarkup?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  disableIndustryValidation?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  cashEnabled?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  creditCardEnabled?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  cryptoEnabled?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlineEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashMinAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditCardMinAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cryptoMinAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  onlineMinAmount?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
