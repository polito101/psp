import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InternalSecretGuard } from './internal-secret.guard';

// Wrapping timingSafeEqual en jest.fn() delegando a la implementación real.
// Permite verificar que se invoca siempre, incluso cuando las longitudes difieren.
// jest.mock se iza antes de los imports, por lo que el guard recibe el mock.
jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    timingSafeEqual: jest.fn().mockImplementation(
      (a: Uint8Array, b: Uint8Array) => actual.timingSafeEqual(a, b),
    ),
  };
});
import { timingSafeEqual } from 'crypto';

const makeContext = (
  headers: Record<string, string | string[] | undefined>,
  path = '/api/v1/merchants',
  query: Record<string, unknown> = {},
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers, path, query }),
    }),
  }) as unknown as ExecutionContext;

const makeConfig = (value: string | undefined) => ({
  get: jest.fn().mockReturnValue(value),
});

describe('InternalSecretGuard', () => {
  const VALID_SECRET = 'super-internal-secret';

  it('returns true when secret matches', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(guard.canActivate(makeContext({ 'x-internal-secret': VALID_SECRET }))).toBe(true);
  });

  it('throws Unauthorized when header is missing', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when header is an empty string', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': '' })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when secret is wrong', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': 'wrong-secret' })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when INTERNAL_API_SECRET env var is not configured', () => {
    const guard = new InternalSecretGuard(makeConfig(undefined) as never);
    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': VALID_SECRET })),
    ).toThrow(UnauthorizedException);
  });

  it('uses first element when header arrives as string array (no 500)', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    // Express puede entregar headers repetidos como string[].
    expect(
      guard.canActivate(makeContext({ 'x-internal-secret': [VALID_SECRET, 'other'] })),
    ).toBe(true);
  });

  it('throws Unauthorized when array header first element does not match', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': ['wrong', VALID_SECRET] })),
    ).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized when provided secret has different length', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': 'short' })),
    ).toThrow(UnauthorizedException);
  });

  it('calls timingSafeEqual even when lengths differ (no short-circuit)', () => {
    // Verifica que timingSafeEqual se invoca siempre, independientemente de si la
    // longitud del secreto proporcionado coincide con la esperada. Sin esta garantía,
    // un atacante podría inferir la longitud del secreto configurado midiendo el tiempo
    // de respuesta: las requests con longitud incorrecta devolverían 401 más rápido
    // porque el cortocircuito de `sameLength && timingSafeEqual(...)` evitaría la
    // comparación de tiempo constante.
    (timingSafeEqual as jest.Mock).mockClear();
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);

    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': 'short' })),
    ).toThrow(UnauthorizedException);

    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it('throws Forbidden when merchant scope path merchant mismatches finance route', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v2/payments/ops/merchants/mrc_2/finance/summary',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws BadRequest (not 500) when finance path merchant segment has invalid percent-encoding', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    try {
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v2/payments/ops/merchants/%ZZ/finance/summary',
          {},
        ),
      );
      throw new Error('expected BadRequestException');
    } catch (e) {
      if (e instanceof Error && e.message === 'expected BadRequestException') {
        throw e;
      }
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('throws Forbidden when merchant scope hits global metrics', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v2/payments/ops/metrics',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws Forbidden when merchant scope lists transactions without matching merchantId query', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v2/payments/ops/transactions',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows merchant scope when merchantId query matches', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v2/payments/ops/transactions',
          { merchantId: 'mrc_1' },
        ),
      ),
    ).toBe(true);
  });

  it('throws Forbidden when payments ops request misses X-Backoffice-Role', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext({ 'x-internal-secret': VALID_SECRET }, '/api/v2/payments/ops/metrics', {}),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows payments ops metrics with admin role', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'admin',
          },
          '/api/v2/payments/ops/metrics',
          {},
        ),
      ),
    ).toBe(true);
  });

  it('throws Forbidden when merchant scope attempts payment notification resend', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v2/payments/ops/payments/pay_1/notifications/del_1/resend',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows admin role for payment notification resend path', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'admin',
          },
          '/api/v2/payments/ops/payments/pay_1/notifications/del_1/resend',
          {},
        ),
      ),
    ).toBe(true);
  });

  it('throws Forbidden when merchant onboarding ops request misses X-Backoffice-Role', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          { 'x-internal-secret': VALID_SECRET },
          '/api/v1/merchant-onboarding/ops/applications',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws Forbidden when merchant onboarding ops request uses merchant role', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v1/merchant-onboarding/ops/applications',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows merchant onboarding ops request with admin role', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'admin',
          },
          '/api/v1/merchant-onboarding/ops/applications',
          {},
        ),
      ),
    ).toBe(true);
  });

  it('allows merchant portal login with internal secret only (no backoffice role)', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(
      guard.canActivate(
        makeContext(
          { 'x-internal-secret': VALID_SECRET },
          '/api/v1/merchant-onboarding/ops/merchant-login',
          {},
        ),
      ),
    ).toBe(true);
  });

  it('requires admin role for merchant-onboarding ops paths that extend merchant-login prefix', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          { 'x-internal-secret': VALID_SECRET },
          '/api/v1/merchant-onboarding/ops/merchant-login-audit',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws Forbidden when merchant role hits payments ops configuration', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'mrc_1',
          },
          '/api/v2/payments/ops/configuration/providers',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows admin role for payments ops configuration endpoints', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'admin',
          },
          '/api/v2/payments/ops/configuration/routes',
          {},
        ),
      ),
    ).toBe(true);
  });

  it('throws Forbidden when non-ops request sends merchant backoffice role', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(
        makeContext(
          {
            'x-internal-secret': VALID_SECRET,
            'x-backoffice-role': 'merchant',
            'x-backoffice-merchant-id': 'm1',
          },
          '/api/v1/merchants',
          {},
        ),
      ),
    ).toThrow(ForbiddenException);
  });
});
