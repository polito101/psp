import { createHmac, randomUUID } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import request from 'supertest';
import { INestApplication } from '@nestjs/common/interfaces';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetIntegrationDb } from './helpers/integration-app';

type ReceivedWebhook = {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
};

function buildStripeSignatureHeader(payload: string, secret: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${digest}`;
}

async function waitFor<T>(
  producer: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 200,
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | undefined;
  while (Date.now() - startedAt <= timeoutMs) {
    lastValue = await producer();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms: ${JSON.stringify(lastValue)}`);
}

describe('stripe webhooks outbound integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let originalWorkerEnabled: string | undefined;

  beforeAll(async () => {
    originalWorkerEnabled = process.env.WEBHOOK_WORKER_ENABLED;
    process.env.WEBHOOK_WORKER_ENABLED = 'true';
    const setup = await createIntegrationApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  beforeEach(async () => {
    await resetIntegrationDb(prisma);
  });

  afterAll(async () => {
    process.env.WEBHOOK_WORKER_ENABLED = originalWorkerEnabled;
    await app.close();
  });

  it(
    'delivers payment.succeeded webhook to merchant endpoint with worker enabled',
    async () => {
      const received: ReceivedWebhook[] = [];
      const receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            received.push({
              headers: req.headers,
              body: JSON.parse(raw) as Record<string, unknown>,
            });
            res.statusCode = 200;
            res.end('ok');
          } catch {
            res.statusCode = 400;
            res.end('invalid json');
          }
        });
      });
      await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
      const address = receiver.address();
      if (!address || typeof address === 'string') {
        receiver.close();
        throw new Error('Cannot resolve receiver address');
      }
      const webhookUrl = `http://127.0.0.1:${address.port}/webhook-receiver`;

      try {
        const internalSecret = process.env.INTERNAL_API_SECRET ?? 'integration-internal-secret';
        const merchantResponse = await request(app.getHttpServer())
          .post('/api/v1/merchants')
          .set('X-Internal-Secret', internalSecret)
          .send({
            name: `Merchant Webhook ${Date.now()}`,
            webhookUrl,
          })
          .expect(201);
        const merchant = merchantResponse.body as { id: string };

        const providerRef = `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
        const payment = await prisma.payment.create({
          data: {
            merchantId: merchant.id,
            amountMinor: 2_100,
            currency: 'EUR',
            status: 'authorized',
            rail: 'fiat',
            selectedProvider: 'stripe',
            providerRef,
          },
        });

        const payload = JSON.stringify({
          id: `evt_${randomUUID().replace(/-/g, '')}`,
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: providerRef,
              object: 'payment_intent',
              status: 'succeeded',
            },
          },
        });
        const secret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_integration_test_secret';
        const signature = buildStripeSignatureHeader(payload, secret);

        await request(app.getHttpServer())
          .post('/api/v1/stripe/webhook')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', signature)
          .send(payload)
          .expect(200);

        await waitFor(
          async () =>
            prisma.webhookDelivery.findFirst({
              where: { merchantId: merchant.id, eventType: 'payment.succeeded' },
              orderBy: { createdAt: 'desc' },
              select: { id: true, status: true, attempts: true, lastError: true, payload: true },
            }),
          (delivery) => !!delivery && delivery.status === 'delivered',
          20_000,
          250,
        );

        expect(received.length).toBeGreaterThan(0);
        const delivered = received[0];
        expect(delivered.headers['x-psp-event']).toBe('payment.succeeded');
        expect(delivered.headers['x-psp-delivery-id']).toBeDefined();
        expect(typeof delivered.headers['x-psp-signature']).toBe('string');
        expect(delivered.body.type).toBe('payment.succeeded');
        expect(delivered.body.data).toEqual(
          expect.objectContaining({
            payment_id: payment.id,
            amount_minor: 2100,
            currency: 'EUR',
            status: 'succeeded',
            provider: 'stripe',
          }),
        );
      } finally {
        await new Promise<void>((resolve) => receiver.close(() => resolve()));
      }
    },
    30_000,
  );
});
