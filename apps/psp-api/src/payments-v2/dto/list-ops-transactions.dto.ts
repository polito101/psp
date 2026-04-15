import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'requires_action',
  'authorized',
  'succeeded',
  'failed',
  'canceled',
  'refunded',
] as const;

const PAYMENT_PROVIDERS = ['stripe', 'mock'] as const;

export class ListOpsTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentId?: string;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: (typeof PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsIn(PAYMENT_PROVIDERS)
  provider?: (typeof PAYMENT_PROVIDERS)[number];

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
