import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard, MERCHANT_KEY } from './api-key.guard';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));
import { compare } from 'bcryptjs';

// El DUMMY_HASH ya no se calcula en tiempo de módulo; es el literal precomputado del guard.
const DUMMY_HASH = '$2b$12$mNdNhOlp1G8aJ3nwPInclOPq9ClQCn/Lxt0XHVeaXiy0Kq1D3A5WW';

describe('ApiKeyGuard', () => {
  const prisma = {
    merchant: {
      findUnique: jest.fn(),
    },
  };

  const makeContext = (
    headers: Record<string, string | undefined>,
    reqExtras: Record<string, unknown> = {},
  ): ExecutionContext => {
    const req = reqExtras;
    req.headers = headers;
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  };

  let guard: ApiKeyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ApiKeyGuard(prisma as never);
  });

  it('returns Unauthorized when header is missing', async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns Unauthorized when API key format is invalid', async () => {
    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'invalid-key-format' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns Unauthorized when merchant does not exist and still calls compare for timing', async () => {
    prisma.merchant.findUnique.mockResolvedValue(null);
    (compare as jest.Mock).mockResolvedValue(false);

    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'psp.m_1.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // bcrypt.compare debe invocarse aunque el merchant no exista (anti-timing).
    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare).toHaveBeenCalledWith('psp.m_1.secret', DUMMY_HASH);
  });

  it('returns Unauthorized when api key hash comparison fails', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      id: 'm_1',
      apiKeyHash: 'hash',
      apiKeyRevokedAt: null,
      apiKeyExpiresAt: null,
    });
    (compare as jest.Mock).mockResolvedValue(false);

    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'psp.m_1.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns Unauthorized when api key is revoked, even if hash matches', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      id: 'm_1',
      apiKeyHash: 'hash',
      apiKeyRevokedAt: new Date('2026-01-01'),
      apiKeyExpiresAt: null,
    });
    // compare devuelve true: se verifica que revocación tiene precedencia y se rechaza igualmente.
    (compare as jest.Mock).mockResolvedValue(true);

    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'psp.m_1.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('returns Unauthorized when api key is expired, even if hash matches', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      id: 'm_1',
      apiKeyHash: 'hash',
      apiKeyRevokedAt: null,
      apiKeyExpiresAt: new Date(Date.now() - 1000),
    });
    // compare devuelve true: se verifica que expiración tiene precedencia y se rechaza igualmente.
    (compare as jest.Mock).mockResolvedValue(true);

    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'psp.m_1.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(compare).toHaveBeenCalledTimes(1);
  });

  it('sets only minimal merchant context when api key is valid', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      id: 'm_1',
      apiKeyHash: 'hash',
      apiKeyRevokedAt: null,
      apiKeyExpiresAt: null,
    });
    (compare as jest.Mock).mockResolvedValue(true);

    const req: Record<string, unknown> = {};
    const context = makeContext({ 'x-api-key': 'psp.m_1.secret' }, req);
    const canActivate = await guard.canActivate(context);

    expect(canActivate).toBe(true);
    expect(req[MERCHANT_KEY]).toEqual({ id: 'm_1' });
  });
});

