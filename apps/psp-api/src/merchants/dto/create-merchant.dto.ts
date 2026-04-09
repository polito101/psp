import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateMerchantDto {
  @ApiProperty({ example: 'Tienda Demo SL' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ description: 'URL HTTPS para webhooks salientes' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;
}
