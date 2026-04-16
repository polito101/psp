import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const PAYMENT_PROVIDERS = ['stripe', 'mock'] as const;

/**
 * Filtros base compartidos con `GET .../ops/transactions` (sin estado ni cursores).
 * Usado por el agregado de conteos por `status` en una sola query.
 */
export class OpsTransactionCountsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  merchantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentId?: string;

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
