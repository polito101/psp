import {
  MerchantMidAllocationFailedError,
  MERCHANT_MID_UNIQUE_CONSTRAINT,
} from './allocate-unique-merchant-mid';
import { midAllocationConflictDiagnostics } from './mid-allocation-conflict-log';

describe('midAllocationConflictDiagnostics', () => {
  it('incluye reason y capas de causa con código Postgres', () => {
    const dbError = Object.assign(new Error('relation "merchant_mid_seq" does not exist'), {
      code: '42P01',
    });
    const err = new MerchantMidAllocationFailedError('sequence_unavailable', { cause: dbError });

    const out = midAllocationConflictDiagnostics(err);

    expect(out.midAllocationReason).toBe('sequence_unavailable');
    expect(out.layers).toHaveLength(2);
    expect(out.layers[0]).toMatchObject({
      name: 'MerchantMidAllocationFailedError',
    });
    expect(out.layers[1]).toMatchObject({
      name: 'Error',
      postgresSqlState: '42P01',
    });
  });

  it('extrae prismaCode P2002 desde errores tipo Prisma', () => {
    const prismaLike = {
      name: 'PrismaClientKnownRequestError',
      message: 'Unique constraint failed',
      code: 'P2002',
      meta: { modelName: 'Merchant', target: ['mid'] },
    };

    const out = midAllocationConflictDiagnostics(prismaLike);

    expect(out.midAllocationReason).toBeUndefined();
    expect(out.layers[0]).toMatchObject({
      prismaCode: 'P2002',
      prismaModelName: 'Merchant',
      prismaTarget: ['mid'],
    });
  });

  it('reconoce target por nombre de constraint Prisma', () => {
    const prismaLike = {
      code: 'P2002',
      meta: { modelName: 'Merchant', target: [MERCHANT_MID_UNIQUE_CONSTRAINT] },
    };

    const out = midAllocationConflictDiagnostics(prismaLike);

    expect(out.layers[0]).toMatchObject({
      prismaCode: 'P2002',
      prismaTarget: [MERCHANT_MID_UNIQUE_CONSTRAINT],
    });
  });
});
