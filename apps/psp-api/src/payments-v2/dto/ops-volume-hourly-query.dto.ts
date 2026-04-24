import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';

/** Serie horaria ops: hoy UTC vs un día calendario UTC anterior (por defecto ayer). */
export type OpsVolumeHourlyMetric = 'volume_net' | 'succeeded_count';

/**
 * Filtros opcionales para volumen horario ops (mismo criterio base que conteos: merchant/proveedor).
 * Calendario UTC: hoy vs `compareUtcDate` (YYYY-MM-DD), estrictamente anterior a hoy UTC.
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

  /** Por defecto `volume_net` (snapshot `PaymentFeeQuote.net_minor` o `amount_minor` si no hay quote). */
  @IsOptional()
  @IsIn(['volume_net', 'succeeded_count'])
  metric?: OpsVolumeHourlyMetric;

  /** Día calendario UTC de la serie de comparación (`YYYY-MM-DD`). Si se omite, ayer UTC. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  compareUtcDate?: string;
}
