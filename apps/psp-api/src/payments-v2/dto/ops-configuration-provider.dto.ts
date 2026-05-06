import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateOpsConfigurationProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  integrationBaseUrl!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  initPaymentResource!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isConfigured?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPublished?: boolean;
}

export class PatchOpsConfigurationProviderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  integrationBaseUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  initPaymentResource?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isConfigured?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPublished?: boolean;
}
