import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../domain/payment-provider-names';

/** Serie horaria ops: hoy UTC vs un día calendario UTC anterior (por defecto ayer). */
export type OpsVolumeHourlyMetric = 'volume_gross' | 'volume_net' | 'succeeded_count';

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

  /**
   * Por defecto `volume_gross` (suma `amount_minor` succeeded). `volume_net`: suma `net_minor` del fee quote con
   * fallback a `amount_minor`. `succeeded_count`: número de pagos succeeded.
   */
  @IsOptional()
  @IsIn(['volume_gross', 'volume_net', 'succeeded_count'])
  metric?: OpsVolumeHourlyMetric;

  /**
   * Día calendario UTC de la serie de comparación (`YYYY-MM-DD`). Si se omite, ayer UTC.
   * Validación en servicio: fecha de calendario válida, estrictamente anterior a hoy UTC, y no más de 730 días atrás.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  compareUtcDate?: string;
}
