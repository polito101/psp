import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MerchantIndustry, MerchantRegistrationStatus } from '../../generated/prisma/enums';

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class PatchMerchantAccountDto {
  @ApiPropertyOptional({ description: 'Nombre comercial del merchant', minLength: 2, maxLength: 160 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ description: 'Email de cuenta (normalizado en servidor)' })
  @IsOptional()
  @Transform(trimString)
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ description: 'Nombre de contacto' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ description: 'Teléfono de contacto' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({
    description: 'Sitio web (null borra el valor)',
    nullable: true,
    maxLength: 2048,
  })
  @IsOptional()
  @ValidateIf((o) => o.websiteUrl !== null && typeof o.websiteUrl === 'string')
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  websiteUrl?: string | null;

  @ApiPropertyOptional({ enum: MerchantRegistrationStatus, enumName: 'MerchantRegistrationStatus' })
  @IsOptional()
  @IsEnum(MerchantRegistrationStatus)
  registrationStatus?: MerchantRegistrationStatus;

  @ApiPropertyOptional({ description: 'Número de registro mercantil (null borra)', nullable: true, maxLength: 64 })
  @IsOptional()
  @ValidateIf((o) => o.registrationNumber !== null && typeof o.registrationNumber === 'string')
  @IsString()
  @MaxLength(64)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ enum: MerchantIndustry, enumName: 'MerchantIndustry' })
  @IsOptional()
  @IsEnum(MerchantIndustry)
  industry?: MerchantIndustry;

  @ApiPropertyOptional({ description: 'Activo / desactivado administrativamente' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
