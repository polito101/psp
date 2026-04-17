import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_V2_STATUS, PaymentOperation } from '../../domain/payment-status';
import { PaymentProvider, ProviderContext, ProviderResult } from '../payment-provider.interface';

/**
 * Placeholder del primer PSP/adquirente “real” (nombre estable `acme`).
 * Sin `PAYMENTS_ACME_ENABLED=true` el adapter no se inyecta en `PAYMENT_PROVIDERS` (ver módulo).
 * Cuando exista integración, sustituir el cuerpo de `run` por llamadas HTTP reales manteniendo la taxonomía de `ProviderResult`.
 */
@Injectable()
export class AcmeProviderAdapter implements PaymentProvider {
  readonly name = 'acme' as const;

  constructor(private readonly config: ConfigService) {}

  async run(operation: PaymentOperation, _context: ProviderContext): Promise<ProviderResult> {
    const enabled = (this.config.get<string>('PAYMENTS_ACME_ENABLED') ?? 'false').toLowerCase() === 'true';
    if (!enabled) {
      return {
        status: PAYMENT_V2_STATUS.FAILED,
        reasonCode: 'provider_unavailable',
        reasonMessage: 'Acme PSP adapter is disabled (PAYMENTS_ACME_ENABLED)',
        transientError: false,
      };
    }
    return {
      status: PAYMENT_V2_STATUS.FAILED,
      reasonCode: 'provider_unavailable',
      reasonMessage: `Acme PSP operation "${operation}" is not implemented yet`,
      transientError: false,
    };
  }
}
