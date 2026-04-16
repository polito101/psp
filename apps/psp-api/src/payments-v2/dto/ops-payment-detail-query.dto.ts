import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Query opcional para el detalle ops de un pago.
 * `includePayload=true` incluye `responsePayload` por intento (solo para depuración; volumen y metadata sensible).
 */
export class OpsPaymentDetailQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean()
  includePayload?: boolean;
}
