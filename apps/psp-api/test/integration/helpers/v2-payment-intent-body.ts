import type { CreatePaymentIntentDto } from '../../../src/payments-v2/dto/create-payment-intent.dto';

const DEFAULT_HOST = 'https://example.com';

/**
 * Cuerpo mínimo válido para `POST /api/v2/payments` (solo contrato decimal + customer).
 * Los tests pueden pasar `amount`/`currency` y el resto de campos vía `overrides`.
 */
export function v2PaymentIntentBody(
  overrides: Partial<CreatePaymentIntentDto> & Pick<CreatePaymentIntentDto, 'amount' | 'currency'>,
): CreatePaymentIntentDto {
  return {
    channel: 'ONLINE',
    language: 'EN',
    orderId: 'ord-int',
    description: 'integration',
    notificationUrl: `${DEFAULT_HOST}/notify`,
    returnUrl: `${DEFAULT_HOST}/ok`,
    cancelUrl: `${DEFAULT_HOST}/cancel`,
    customer: {
      firstName: 'A',
      lastName: 'B',
      email: 'a@example.com',
      country: 'ES',
    },
    ...overrides,
  };
}
