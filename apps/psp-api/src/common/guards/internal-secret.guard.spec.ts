import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalSecretGuard } from './internal-secret.guard';

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

  it('throws Unauthorized when provided secret has different length (no timing shortcut)', () => {
    const guard = new InternalSecretGuard(makeConfig(VALID_SECRET) as never);
    expect(() =>
      guard.canActivate(makeContext({ 'x-internal-secret': 'short' })),
    ).toThrow(UnauthorizedException);
  });
});
