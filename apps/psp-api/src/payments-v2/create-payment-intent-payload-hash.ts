import { createHash } from 'crypto';
import type { CreatePaymentCustomerDto, CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

/**
 * JSON con claves ordenadas lexicográficamente en cada objeto (estable ante orden de claves del cliente).
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(toSortedJson(value));
}

function toSortedJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toSortedJson);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = toSortedJson(record[key]);
  }
  return sorted;
}

function normOptionalString(s: string | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t === '' ? null : t;
}

function canonicalCustomerV2(c: CreatePaymentCustomerDto): Record<string, unknown> {
  const raw = c.address;
  let address: Record<string, unknown> | null = null;
  if (raw) {
    address = {
      city: normOptionalString(raw.city),
      line1: normOptionalString(raw.line1),
      neighborhood: normOptionalString(raw.neighborhood),
      number: normOptionalString(raw.number),
      postcode: normOptionalString(raw.postcode),
      state: normOptionalString(raw.state),
    };
    if (Object.values(address).every((v) => v === null)) {
      address = null;
    }
  }
  return {
    country: c.country.trim().toUpperCase(),
    email: c.email.trim().toLowerCase(),
    firstName: c.firstName.trim(),
    lastName: c.lastName.trim(),
    ip: normOptionalString(c.ip),
    personalId: normOptionalString(c.personalId),
    phone: normOptionalString(c.phone),
    uid: normOptionalString(c.uid),
    address,
  };
}

/**
 * Huella canónica del cuerpo de `POST /v2/payments` para idempotencia de creación.
 */
export function hashCreatePaymentIntentPayload(dto: CreatePaymentIntentDto): string {
  if (dto.amountMinor != null && dto.amount == null) {
    const canonical = {
      v: 1 as const,
      amountMinor: dto.amountMinor,
      currency: dto.currency.toUpperCase(),
      paymentLinkId: normOptionalString(dto.paymentLinkId),
      payerCountry: normOptionalString(dto.payerCountry)?.toUpperCase() ?? null,
      paymentMethodCode: dto.paymentMethodCode ? dto.paymentMethodCode.trim().toLowerCase() : null,
    };
    return createHash('sha256').update(stableStringify(canonical), 'utf8').digest('hex');
  }

  if (dto.amount != null) {
    const canonical = {
      v: 2 as const,
      amount: dto.amount,
      currency: dto.currency.toUpperCase(),
      channel: dto.channel ?? null,
      language: dto.language?.trim().toUpperCase() ?? null,
      orderId: normOptionalString(dto.orderId),
      description: normOptionalString(dto.description),
      notificationUrl: normOptionalString(dto.notificationUrl),
      returnUrl: normOptionalString(dto.returnUrl),
      cancelUrl: normOptionalString(dto.cancelUrl),
      customer: dto.customer ? canonicalCustomerV2(dto.customer) : null,
      paymentLinkId: normOptionalString(dto.paymentLinkId),
      paymentMethodCode: dto.paymentMethodCode ? dto.paymentMethodCode.trim().toLowerCase() : null,
    };
    return createHash('sha256').update(stableStringify(canonical), 'utf8').digest('hex');
  }

  throw new Error('Create payment payload must include either amountMinor or amount');
}
