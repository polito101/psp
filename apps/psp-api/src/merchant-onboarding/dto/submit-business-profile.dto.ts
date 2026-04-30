import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Length, MaxLength, MinLength } from 'class-validator';

export class SubmitBusinessProfileDto {
  @ApiProperty({ example: 'Ada Shop' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  tradeName!: string;

  @ApiProperty({ example: 'Ada Shop SL' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @ApiProperty({ example: 'ES' })
  @IsString()
  @Length(2, 2)
  country!: string;

  @ApiPropertyOptional({ example: 'https://adashop.example' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  website?: string;

  @ApiProperty({ example: 'ecommerce' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessType!: string;
}
