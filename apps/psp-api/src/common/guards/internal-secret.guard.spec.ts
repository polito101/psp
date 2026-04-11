import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
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
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
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
});
