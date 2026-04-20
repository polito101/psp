import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';

const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'requires_action',
  'authorized',
  'succeeded',
  'disputed',
  'dispute_lost',
  'failed',
  'canceled',
  'refunded',
] as const;

export class ListOpsTransactionsDto {
  /**
   * Compatibilidad: el endpoint pasa a ser cursor-based. `page>1` ya no se soporta para evitar offsets profundos.
   * Mantenerlo permite que callers antiguos sigan funcionando en la primera página.
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

  /**
   * Cursor: timestamp ISO (createdAt) del boundary item.
   * Con `direction=next` significa "dame items más viejos que este cursor".
   * Con `direction=prev` significa "dame items más nuevos que este cursor".
   */
  @IsOptional()
  @IsDateString()
  cursorCreatedAt?: string;

  /** Cursor: id del boundary item (tiebreaker estable junto con createdAt). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursorId?: string;

  @IsOptional()
  @IsIn(['next', 'prev'] as const)
  direction?: 'next' | 'prev';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  merchantId?: string;

  /**
   * Coincidencia por subcadena (case-insensitive) sobre el id interno del pago (`Payment.id`), no sobre el id público tipo `pay_*`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentId?: string;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: (typeof PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsIn([...PAYMENT_PROVIDER_NAMES])
  provider?: PaymentProviderName;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  /**
   * Si es `false`, no se ejecuta `count()` sobre los filtros (útil con polling frecuente).
   * `total` y `totalPages` vendrán como `null`. Por defecto se comporta como `true`.
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
