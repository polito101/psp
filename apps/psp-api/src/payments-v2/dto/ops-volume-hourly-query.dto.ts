import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const PAYMENT_PROVIDERS = ['stripe', 'mock'] as const;

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
  @IsIn(PAYMENT_PROVIDERS)
  provider?: (typeof PAYMENT_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
