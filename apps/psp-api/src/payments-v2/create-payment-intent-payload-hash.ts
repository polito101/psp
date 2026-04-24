import { createHash } from 'crypto';
import type { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

/**
 * Huella canónica del cuerpo de `POST /v2/payments` para idempotencia de creación.
 */
export function hashCreatePaymentIntentPayload(dto: CreatePaymentIntentDto): string {
  const canonical = {
    v: 1 as const,
    amountMinor: dto.amountMinor,
    currency: dto.currency.toUpperCase(),
    paymentLinkId: dto.paymentLinkId ?? null,
    payerCountry: dto.payerCountry ? dto.payerCountry.toUpperCase() : null,
    paymentMethodCode: dto.paymentMethodCode ? dto.paymentMethodCode.trim().toLowerCase() : null,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}
