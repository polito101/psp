/**
 * Filtros `provider` alineados con `PAYMENT_PROVIDER_NAMES` en psp-api (ops / métricas).
 * Mantener en sync al añadir PSPs.
 */
export const OPS_PAYMENT_PROVIDERS = ["stripe", "mock", "acme"] as const;

export type OpsPaymentProvider = (typeof OPS_PAYMENT_PROVIDERS)[number];
