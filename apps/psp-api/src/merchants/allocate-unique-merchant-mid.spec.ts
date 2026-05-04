import type { Prisma } from '../generated/prisma/client';
import {
  MERCHANT_MID_UNIQUE_CONSTRAINT,
  MerchantMidAllocationFailedError,
  createMerchantWithUniqueMid,
  isMerchantMidUniqueViolation,
} from './allocate-unique-merchant-mid';

describe('allocate-unique-merchant-mid', () => {
  describe('isMerchantMidUniqueViolation', () => {
    it('es true para P2002 en Merchant.mid', () => {
      expect(
        isMerchantMidUniqueViolation({
          code: 'P2002',
          meta: { modelName: 'Merchant', target: ['mid'] },
        }),
      ).toBe(true);
    });

    it('es true para el nombre de constraint Prisma', () => {
      expect(
        isMerchantMidUniqueViolation({
          code: 'P2002',
          meta: { modelName: 'Merchant', target: [MERCHANT_MID_UNIQUE_CONSTRAINT] },
        }),
      ).toBe(true);
    });

    it('es false si el modelo no es Merchant', () => {
      expect(
        isMerchantMidUniqueViolation({
          code: 'P2002',
          meta: { modelName: 'Other', target: ['mid'] },
        }),
      ).toBe(false);
    });

    it('es false si el target no es mid', () => {
      expect(
        isMerchantMidUniqueViolation({
          code: 'P2002',
          meta: { modelName: 'Merchant', target: ['email'] },
        }),
      ).toBe(false);
    });
  });

  describe('createMerchantWithUniqueMid', () => {
    it('reintenta ante P2002 de mid y termina en éxito', async () => {
      const created = { id: 'm1', mid: '123457' };
      const p2002 = {
        code: 'P2002',
        meta: { modelName: 'Merchant', target: ['mid'] },
      };
      const $queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ seq: BigInt(123456) }])
        .mockResolvedValueOnce([{ seq: BigInt(123457) }]);
      const create = jest.fn().mockRejectedValueOnce(p2002).mockResolvedValueOnce(created);
      const tx = { merchant: { create }, $queryRaw } as unknown as Prisma.TransactionClient;

      await expect(
        createMerchantWithUniqueMid(tx, (mid) => ({
          name: 'Acme',
          mid,
          apiKeyHash: 'placeholder',
          webhookSecretCiphertext: 'ct',
        })),
      ).resolves.toBe(created);

      expect($queryRaw).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[0][0]).toMatchObject({
        data: expect.objectContaining({ mid: '123456' }),
      });
      expect(create.mock.calls[1][0]).toMatchObject({
        data: expect.objectContaining({ mid: '123457' }),
      });
    });

    it('lanza MerchantMidAllocationFailedError tras agotar intentos', async () => {
      const err = { code: 'P2002', meta: { modelName: 'Merchant', target: ['mid'] } };
      const $queryRaw = jest.fn().mockResolvedValue([{ seq: BigInt(900001) }]);
      const create = jest.fn().mockRejectedValue(err);
      const tx = { merchant: { create }, $queryRaw } as unknown as Prisma.TransactionClient;

      await expect(
        createMerchantWithUniqueMid(
          tx,
          (mid) => ({
            name: 'x',
            mid,
            apiKeyHash: 'h',
            webhookSecretCiphertext: 'ct',
          }),
          {
            maxAttempts: 2,
          },
        ),
      ).rejects.toBeInstanceOf(MerchantMidAllocationFailedError);

      expect(create).toHaveBeenCalledTimes(2);
      expect($queryRaw).toHaveBeenCalledTimes(2);
    });

    it('propaga errores que no son colisión de mid', async () => {
      const other = { code: 'P2003', meta: {} };
      const $queryRaw = jest.fn().mockResolvedValue([{ seq: BigInt(1) }]);
      const create = jest.fn().mockRejectedValueOnce(other);
      const tx = { merchant: { create }, $queryRaw } as unknown as Prisma.TransactionClient;

      await expect(
        createMerchantWithUniqueMid(tx, (mid) => ({
          name: 'x',
          mid,
          apiKeyHash: 'h',
          webhookSecretCiphertext: 'ct',
        })),
      ).rejects.toBe(other);

      expect($queryRaw).toHaveBeenCalledTimes(1);
    });

    it('si $queryRaw falla, lanza MerchantMidAllocationFailedError con la causa original', async () => {
      const dbError = Object.assign(new Error('relation "merchant_mid_seq" does not exist'), {
        code: '42P01',
      });
      const $queryRaw = jest.fn().mockRejectedValue(dbError);
      const create = jest.fn();
      const tx = { merchant: { create }, $queryRaw } as unknown as Prisma.TransactionClient;

      await expect(
        createMerchantWithUniqueMid(tx, (mid) => ({
          name: 'x',
          mid,
          apiKeyHash: 'h',
          webhookSecretCiphertext: 'ct',
        })),
      ).rejects.toMatchObject({
        name: 'MerchantMidAllocationFailedError',
        reason: 'sequence_unavailable',
        cause: dbError,
      });

      expect($queryRaw).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
