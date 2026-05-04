import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { MerchantIndustry } from '../../generated/prisma/enums';

export class SubmitBusinessProfileDto {
  @ApiProperty({ example: 'Levels Ltd' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  companyName!: string;

  @ApiProperty({ enum: MerchantIndustry, example: MerchantIndustry.FOREX })
  @IsEnum(MerchantIndustry)
  industry!: MerchantIndustry;

  @ApiPropertyOptional({ example: 'https://levels.example' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  websiteUrl?: string;
}
