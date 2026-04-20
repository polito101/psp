import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';
import { PAYMENT_V2_STATUS, PaymentV2Status } from '../domain/payment-status';

export class OpsMerchantFinanceTransactionsQueryDto {
  /**
   * Compatibilidad: listado cursor-based; `page>1` no se admite (evita `OFFSET` profundo).
   */
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
  @IsIn(Object.values(PAYMENT_V2_STATUS))
  status?: PaymentV2Status;

  @IsOptional()
  @IsIn([...PAYMENT_PROVIDER_NAMES])
  provider?: PaymentProviderName;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentId?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @IsOptional()
  @IsDateString()
  cursorCreatedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursorId?: string;

  @IsOptional()
  @IsIn(['next', 'prev'] as const)
  direction?: 'next' | 'prev';

  /**
   * Con `false` no se ejecuta `count()`; `page.total` y `page.totalPages` serán `null` (útil con polling).
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  includeTotal?: boolean;
}
