import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateOpsConfigurationRouteDto,
  OpsConfigurationRouteCurrencyDto,
  OPS_CONFIGURATION_ROUTE_CURRENCY_AMOUNT_MAX,
} from './ops-configuration-route.dto';

const validationOpts = { whitelist: true, forbidNonWhitelisted: true } as const;

function minimalCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'prov_1',
    methodCode: 'card',
    methodName: 'Card',
    countryCode: 'MX',
    channel: 'ONLINE',
    integrationMode: 'REDIRECTION',
    requestTemplate: 'REDIRECT_SIMPLE',
    currencies: [{ currency: 'MXN', minAmount: 1, maxAmount: 1000, isDefault: true }],
    ...overrides,
  };
}

describe('OpsConfigurationRouteCurrencyDto', () => {
  it('rechaza minAmount no numérico que tras @Type queda NaN', () => {
    const inst = plainToInstance(OpsConfigurationRouteCurrencyDto, {
      currency: 'MXN',
      minAmount: 'abc',
      maxAmount: 100,
    });
    const errors = validateSync(inst, validationOpts);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza importes negativos', () => {
    const inst = plainToInstance(OpsConfigurationRouteCurrencyDto, {
      currency: 'MXN',
      minAmount: -1,
      maxAmount: 100,
    });
    expect(validateSync(inst, validationOpts).length).toBeGreaterThan(0);

    const inst2 = plainToInstance(OpsConfigurationRouteCurrencyDto, {
      currency: 'MXN',
      minAmount: 1,
      maxAmount: -0.01,
    });
    expect(validateSync(inst2, validationOpts).length).toBeGreaterThan(0);
  });

  it('rechaza minAmount > maxAmount', () => {
    const inst = plainToInstance(OpsConfigurationRouteCurrencyDto, {
      currency: 'MXN',
      minAmount: 200,
      maxAmount: 100,
    });
    const errors = validateSync(inst, validationOpts);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza Infinity', () => {
    const inst = plainToInstance(OpsConfigurationRouteCurrencyDto, {
      currency: 'MXN',
      minAmount: Number.POSITIVE_INFINITY,
      maxAmount: 100,
    });
    expect(validateSync(inst, validationOpts).length).toBeGreaterThan(0);
  });

  it('acepta valores en rango', () => {
    const inst = plainToInstance(OpsConfigurationRouteCurrencyDto, {
      currency: 'MXN',
      minAmount: 0,
      maxAmount: OPS_CONFIGURATION_ROUTE_CURRENCY_AMOUNT_MAX,
    });
    expect(validateSync(inst, validationOpts)).toHaveLength(0);
  });
});

describe('CreateOpsConfigurationRouteDto currencies', () => {
  it('propaga validación en currencies anidadas (NaN)', () => {
    const inst = plainToInstance(
      CreateOpsConfigurationRouteDto,
      minimalCreateBody({
        currencies: [{ currency: 'MXN', minAmount: 'nope', maxAmount: 1 }],
      }),
    );
    expect(validateSync(inst, validationOpts).length).toBeGreaterThan(0);
  });

  it('propaga minAmount > maxAmount en anidado', () => {
    const inst = plainToInstance(
      CreateOpsConfigurationRouteDto,
      minimalCreateBody({
        currencies: [{ currency: 'MXN', minAmount: 50, maxAmount: 10 }],
      }),
    );
    expect(validateSync(inst, validationOpts).length).toBeGreaterThan(0);
  });
});
