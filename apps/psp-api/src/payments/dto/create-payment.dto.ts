import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Length } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ example: 1999 })
  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @ApiProperty({ default: 'EUR' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({ description: 'ID de payment link si proviene de Pay-by-link' })
  @IsOptional()
  @IsString()
  paymentLinkId?: string;

  @ApiPropertyOptional({ enum: ['fiat', 'crypto'] })
  @IsOptional()
  @IsIn(['fiat', 'crypto'])
  rail?: 'fiat' | 'crypto';
}
