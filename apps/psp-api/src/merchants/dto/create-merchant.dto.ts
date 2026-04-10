import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength } from 'class-validator';

export class CreateMerchantDto {
  @ApiProperty({ example: 'Tienda Demo SL' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiPropertyOptional({ description: 'URL HTTPS para webhooks salientes' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;

  @ApiPropertyOptional({
    description: 'Días de validez de la API key (1-3650). Sin valor, la key no expira.',
    example: 90,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  keyTtlDays?: number;
}
