import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';

/**
 * Agregados ops para dos ventanas temporales (created_at inclusive en ambos extremos).
 * Mismos filtros opcionales que conteos/listado ops (merchant, proveedor, moneda).
 */
export class OpsPaymentsSummaryQueryDto {
  @IsDateString()
  currentFrom!: string;

  @IsDateString()
  currentTo!: string;

  @IsDateString()
  compareFrom!: string;

  @IsDateString()
  compareTo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  merchantId?: string;

  @IsOptional()
  @IsIn([...PAYMENT_PROVIDER_NAMES])
  provider?: PaymentProviderName;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
