import { createHash } from 'crypto';
import type { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

/**
 * Huella canónica del cuerpo de `POST /v2/payments` para idempotencia de creación.
 */
export function hashCreatePaymentIntentPayload(dto: CreatePaymentIntentDto): string {
  if (dto.amountMinor != null && dto.amount == null) {
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

  if (dto.amount != null) {
    const canonical = {
      v: 2 as const,
      amount: dto.amount,
      currency: dto.currency.toUpperCase(),
      channel: dto.channel ?? null,
      language: dto.language?.trim().toUpperCase() ?? null,
      orderId: dto.orderId ?? null,
      description: dto.description ?? null,
      notificationUrl: dto.notificationUrl ?? null,
      returnUrl: dto.returnUrl ?? null,
      cancelUrl: dto.cancelUrl ?? null,
      customer: dto.customer ?? null,
      paymentLinkId: dto.paymentLinkId ?? null,
      paymentMethodCode: dto.paymentMethodCode ? dto.paymentMethodCode.trim().toLowerCase() : null,
    };
    return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
  }

  throw new Error('Create payment payload must include either amountMinor or amount');
}
