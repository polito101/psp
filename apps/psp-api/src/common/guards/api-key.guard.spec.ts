import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard, MERCHANT_KEY } from './api-key.guard';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));
import { compare } from 'bcryptjs';

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

  it('returns Unauthorized when merchant does not exist', async () => {
    prisma.merchant.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'psp.m_1.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

  it('returns Unauthorized when api key is revoked', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      id: 'm_1',
      apiKeyHash: 'hash',
      apiKeyRevokedAt: new Date('2026-01-01'),
      apiKeyExpiresAt: null,
    });
    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'psp.m_1.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns Unauthorized when api key is expired', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      id: 'm_1',
      apiKeyHash: 'hash',
      apiKeyRevokedAt: null,
      apiKeyExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      guard.canActivate(makeContext({ 'x-api-key': 'psp.m_1.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

