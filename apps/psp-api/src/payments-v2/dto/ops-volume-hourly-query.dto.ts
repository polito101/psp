import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';

/**
 * Filtros opcionales para volumen horario ops (mismo criterio base que conteos: merchant/proveedor).
 * El rango temporal es siempre calendario UTC: hoy vs ayer.
 */
export class OpsVolumeHourlyQueryDto {
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
