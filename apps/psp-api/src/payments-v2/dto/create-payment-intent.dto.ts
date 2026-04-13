import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Length } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ example: 1999 })
  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @ApiProperty({ default: 'EUR' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({ description: 'ID de payment link asociado al intent' })
  @IsOptional()
  @IsString()
  paymentLinkId?: string;

  @ApiPropertyOptional({ enum: ['stripe', 'mock'] })
  @IsOptional()
  @IsIn(['stripe', 'mock'])
  provider?: 'stripe' | 'mock';
}
