import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common/interfaces';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { PaymentLinksService } from '../../../src/payment-links/payment-links.service';
import { MerchantsService } from '../../../src/merchants/merchants.service';

type MerchantResponse = {
  id: string;
  apiKey: string;
  apiKeyExpiresAt: string | null;
};

export async function createIntegrationApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  paymentLinks: PaymentLinksService;
  merchants: MerchantsService;
}> {
  /**
   * Import dinámico: `ConfigModule.forRoot(validate)` se ejecuta al evaluar `AppModule`.
   * Si este archivo importara `AppModule` arriba del todo, se validaría el entorno antes del
   * `beforeAll` de los specs que ajustan `process.env` (p. ej. cuota merchant), y quedaría
   * `PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED=false` en caché de módulo.
   */
  const { AppModule } = await import('../../../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    paymentLinks: app.get(PaymentLinksService),
    merchants: app.get(MerchantsService),
  };
}

export async function resetIntegrationDb(prisma: PrismaService): Promise<void> {
  await prisma.paymentOperation.deleteMany();
  await prisma.paymentAttempt.deleteMany();
  await prisma.webhookDelivery.deleteMany();
  await prisma.paymentFeeQuote.deleteMany();
  await prisma.merchantRateTable.deleteMany();
  await prisma.ledgerLine.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.paymentLink.deleteMany();
  await prisma.merchant.deleteMany();
}

export async function createMerchantViaHttp(
  app: INestApplication,
  body?: Record<string, unknown>,
): Promise<MerchantResponse> {
  const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
  const response = await request(app.getHttpServer())
    .post('/api/v1/merchants')
    .set('X-Internal-Secret', internalSecret)
    .send({
      name: `Integration Merchant ${Date.now()}`,
      ...body,
    })
    .expect(201);

  return response.body as MerchantResponse;
}
