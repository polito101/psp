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

const OPS_PAYOUT_STATUSES = ['CREATED', 'SENT', 'FAILED'] as const;

export class OpsMerchantFinancePayoutsQueryDto {
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
  @IsIn(OPS_PAYOUT_STATUSES)
  status?: (typeof OPS_PAYOUT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

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
