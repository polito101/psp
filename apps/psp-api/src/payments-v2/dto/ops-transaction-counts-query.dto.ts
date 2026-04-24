import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';

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
  @IsIn([...PAYMENT_PROVIDER_NAMES])
  provider?: PaymentProviderName;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  payerCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethodCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethodFamily?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  merchantActive?: boolean;
}
