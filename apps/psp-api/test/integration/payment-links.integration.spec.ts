import { INestApplication, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createIntegrationApp,
  createMerchantViaHttp,
  resetIntegrationDb,
} from './helpers/integration-app';

describe('payment-links integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let paymentLinks: { findForMerchant: (merchantId: string, id: string) => Promise<unknown> };

  beforeAll(async () => {
    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
    paymentLinks = setup.paymentLinks;
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds link only for its owner merchant', async () => {
    const merchant = await createMerchantViaHttp(app);
    const link = await prisma.paymentLink.create({
      data: {
        merchantId: merchant.id,
        slug: `lnk-${Date.now()}`,
        amountMinor: 2500,
        currency: 'EUR',
        status: 'active',
      },
    });

    const found = await paymentLinks.findForMerchant(merchant.id, link.id);
    expect((found as { id: string }).id).toBe(link.id);
  });

  it('throws not found for non-owner merchant', async () => {
    const merchantA = await createMerchantViaHttp(app, { name: 'Merchant A' });
    const merchantB = await createMerchantViaHttp(app, { name: 'Merchant B' });

    const link = await prisma.paymentLink.create({
      data: {
        merchantId: merchantA.id,
        slug: `lnk-${Date.now()}-b`,
        amountMinor: 3000,
        currency: 'EUR',
        status: 'active',
      },
    });

    await expect(paymentLinks.findForMerchant(merchantB.id, link.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
