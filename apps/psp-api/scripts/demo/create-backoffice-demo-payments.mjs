#!/usr/bin/env node
/**
 * Crea un merchant de prueba, varios pagos v2 con el **contrato decimal (amount + customer + URLs)**,
 * y opcionalmente filas de enrutado dinámico (`payment_provider_configs`, rutas, divisas, tarifas merchant–proveedor)
 * cuando hay `DATABASE_URL` / `DEMO_DATABASE_URL`.
 *
 * Variables (local o CI):
 * - `DEMO_API_BASE_URL` o `SMOKE_BASE_URL`: origen de la API
 * - `INTERNAL_API_SECRET` o `SMOKE_INTERNAL_API_SECRET`
 * - `DATABASE_URL` o `DEMO_DATABASE_URL`: si existe, se inserta configuración de demo de routing (salvo `DEMO_SKIP_ROUTING_SEED=true`)
 * - `PRINT_DEMO_API_KEY=true` o `--print-api-key`
 * - `--bulk-random` / `DEMO_BULK_RANDOM`: volumen extra (importes decimales EUR, evita política mock %7/%13/%17 en céntimos)
 * - `--bulk-only`
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';

const baseUrlRaw = (process.env.DEMO_API_BASE_URL ?? process.env.SMOKE_BASE_URL ?? '').trim();
const internalSecret = (process.env.INTERNAL_API_SECRET ?? process.env.SMOKE_INTERNAL_API_SECRET ?? '').trim();
const dbUrl = (process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL ?? '').trim();
const skipRoutingSeed =
  process.env.DEMO_SKIP_ROUTING_SEED === 'true' || process.env.DEMO_SKIP_ROUTING_SEED === '1';

const fetchTimeoutMs = Math.min(
  120_000,
  Math.max(5_000, Number.parseInt(process.env.DEMO_FETCH_TIMEOUT_MS ?? '90000', 10) || 90_000),
);
const printApiKeyFull =
  process.argv.includes('--print-api-key') ||
  process.env.PRINT_DEMO_API_KEY === 'true' ||
  process.env.PRINT_DEMO_API_KEY === '1';

const argvBulkOnly = process.argv.includes('--bulk-only');
const argvBulkRandom =
  process.argv.includes('--bulk-random') ||
  process.env.DEMO_BULK_RANDOM === 'true' ||
  process.env.DEMO_BULK_RANDOM === '1';

function parsePositiveInt(raw, fallback, label) {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    fail(`${label} debe ser un entero ≥ 1`);
  }
  return n;
}

function randomIntInclusive(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** Importe decimal EUR aleatorio cuya conversión a céntimos evita %7, %13, %17 (mock). */
function randomBulkAmountDecimalEur() {
  for (let k = 0; k < 200; k += 1) {
    const minor = 1000 + Math.floor(Math.random() * 9000);
    if (minor % 7 !== 0 && minor % 13 !== 0 && minor % 17 !== 0) {
      return minor / 100;
    }
  }
  return 19.99;
}

const createGapMs = (() => {
  const raw = process.env.DEMO_CREATE_GAP_MS;
  if (raw === undefined || String(raw).trim() === '') return 2100;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 0) {
    fail('DEMO_CREATE_GAP_MS debe ser un entero ≥ 0');
  }
  return n;
})();

const bulkMinDefault = 40;
const bulkMaxDefault = 10_000;
const bulkMin = parsePositiveInt(process.env.DEMO_BULK_MIN, bulkMinDefault, 'DEMO_BULK_MIN');
const bulkMax = parsePositiveInt(process.env.DEMO_BULK_MAX, bulkMaxDefault, 'DEMO_BULK_MAX');
if (bulkMax < bulkMin) {
  fail(`DEMO_BULK_MAX (${bulkMax}) no puede ser menor que DEMO_BULK_MIN (${bulkMin})`);
}

async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/**
 * Cuerpo `POST /api/v2/payments` (v2). EUR + país ES alinea con `MerchantRateTable` por defecto (solo EUR).
 * Las filas de `payment_method_routes` (ES/MX) quedan listas cuando el runtime aplique enrutado por peso.
 */
function buildV2PaymentBody(overrides = {}) {
  return {
    amount: 19.99,
    currency: 'EUR',
    channel: 'ONLINE',
    language: 'EN',
    orderId: `demo-${randomUUID().slice(0, 8)}`,
    description: 'Demo backoffice payment',
    notificationUrl: 'https://example.com/webhook',
    returnUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/failure',
    customer: {
      firstName: 'Demo',
      lastName: 'Panel',
      email: 'demo@example.com',
      country: 'ES',
    },
    ...overrides,
  };
}

if (!baseUrlRaw) {
  fail('Falta DEMO_API_BASE_URL o SMOKE_BASE_URL (URL base de psp-api, sin /api al final).');
}
if (!internalSecret) {
  fail('Falta INTERNAL_API_SECRET o SMOKE_INTERNAL_API_SECRET.');
}

let origin;
try {
  const u = new URL(baseUrlRaw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('protocolo');
  }
  origin = u.origin;
} catch {
  fail(`URL inválida: ${baseUrlRaw}`);
}

async function request(method, path, { headers = {}, jsonBody } = {}) {
  const url = `${origin}${path}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      headers: {
        ...(jsonBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { _raw: text };
    }
    if (!res.ok) {
      const detail = typeof data.message === 'string' ? data.message : JSON.stringify(data).slice(0, 500);
      throw new Error(`${method} ${path} -> ${res.status}: ${detail}`);
    }
    return data;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Timeout tras ${fetchTimeoutMs}ms: ${method} ${path}`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function seedDynamicRouting(client, merchantId) {
  const providerId = randomUUID();
  const routeRedirectId = randomUUID();
  const routeSpeiId = randomUUID();
  const now = new Date().toISOString();

  await client.query(
    `INSERT INTO payment_provider_configs (
      id, name, description, integration_base_url, init_payment_resource,
      is_configured, is_active, is_published, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, true, true, true, $6, $6)`,
    [
      providerId,
      'Demo dynamic provider',
      'Seed demo para paneles (redirect + SPEI)',
      'https://demo-provider.example.com',
      '/api/v1/payments/init',
      now,
    ],
  );

  await client.query(
    `INSERT INTO payment_method_routes (
      id, provider_id, method_code, method_name, country_code, channel, integration_mode, request_template,
      weight, is_active, is_published, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'ONLINE'::"PaymentChannel", 'REDIRECTION'::"PaymentIntegrationMode", 'REDIRECT_SIMPLE'::"PaymentProviderRequestTemplate",
      10, true, true, $6, $6)`,
    [routeRedirectId, providerId, '2001', 'Cards redirect (demo)', 'ES', now],
  );

  await client.query(
    `INSERT INTO payment_method_route_currencies (id, route_id, currency, min_amount, max_amount, is_default, created_at)
     VALUES ($1, $2, 'EUR', 1, 100000, true, $3)`,
    [randomUUID(), routeRedirectId, now],
  );

  const speiConfig = JSON.stringify({
    target_flow: 'spei',
    merchant_code: 'demo_merchant',
    merchant_api_token: 'demo-token',
  });

  await client.query(
    `INSERT INTO payment_method_routes (
      id, provider_id, method_code, method_name, country_code, channel, integration_mode, request_template,
      weight, is_active, is_published, route_config_json, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'MX', 'ONLINE'::"PaymentChannel", 'S2S'::"PaymentIntegrationMode", 'SPEI_BANK_TRANSFER'::"PaymentProviderRequestTemplate",
      5, true, true, $5::jsonb, $6, $6)`,
    [routeSpeiId, providerId, 'spei_mx', 'SPEI transfer (demo)', speiConfig, now],
  );

  await client.query(
    `INSERT INTO payment_method_route_currencies (id, route_id, currency, min_amount, max_amount, is_default, created_at)
     VALUES ($1, $2, 'MXN', 1, 500000, true, $3)`,
    [randomUUID(), routeSpeiId, now],
  );

  for (const country of ['ES', 'MX']) {
    await client.query(
      `INSERT INTO merchant_provider_rates (
        id, merchant_id, provider_id, country_code, percentage, fixed, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 0, 0, $5, $5)`,
      [randomUUID(), merchantId, providerId, country, now],
    );
  }

  console.log(
    'Routing demo: provider',
    providerId,
    'routes',
    routeRedirectId,
    routeSpeiId,
    '+ merchant_provider_rates ES/MX',
  );
}

const health = await request('GET', '/health');
if (health.status !== 'ok') {
  fail(`/health no está ok (status=${health.status}). Revisa DB/Redis en el deploy.`);
}

const merchant = await request('POST', '/api/v1/merchants', {
  headers: { 'X-Internal-Secret': internalSecret },
  jsonBody: { name: `Demo panel ${new Date().toISOString()}` },
});
const apiKey = merchant.apiKey;
if (!apiKey) {
  fail('La API no devolvió apiKey al crear merchant.');
}

if (dbUrl && !skipRoutingSeed) {
  const pool = new pg.Pool({ connectionString: dbUrl });
  const client = await pool.connect();
  try {
    await seedDynamicRouting(client, merchant.id);
  } catch (e) {
    console.warn(
      '[demo] No se pudo sembrar routing (¿migración 20260506120000 aplicada?).',
      e instanceof Error ? e.message : e,
    );
  } finally {
    client.release();
    await pool.end();
  }
} else if (!dbUrl) {
  console.log('[demo] Sin DATABASE_URL: omitiendo seed Prisma de payment_provider_configs / rutas.');
} else {
  console.log('[demo] DEMO_SKIP_ROUTING_SEED: omitiendo seed de routing.');
}

const v2 = (path, body, extraHeaders = {}) =>
  request('POST', path, {
    headers: { 'X-API-Key': apiKey, ...extraHeaders },
    jsonBody: body,
  });

console.log('Merchant creado:', merchant.id);

let bulkExtraCount = 0;
if (argvBulkRandom) {
  bulkExtraCount = randomIntInclusive(bulkMin, bulkMax);
  console.log(
    `Bulk aleatorio: ${bulkExtraCount} pagos (create+capture) en rango [${bulkMin}, ${bulkMax}] (DEMO_CREATE_GAP_MS=${createGapMs})`,
  );
}

if (!argvBulkOnly) {
  const idem1 = randomUUID();
  const p1 = await v2('/api/v2/payments', buildV2PaymentBody({ orderId: `idem-${idem1.slice(0, 8)}` }), {
    'Idempotency-Key': idem1,
  });
  const id1 = p1.payment?.id;
  if (!id1) fail('Respuesta create sin payment.id');
  await v2(`/api/v2/payments/${id1}/capture`, {});
  await v2(`/api/v2/payments/${id1}/refund`, {});
  console.log('Pago refunded:', id1);

  const p2 = await v2('/api/v2/payments', buildV2PaymentBody());
  const id2 = p2.payment?.id;
  await v2(`/api/v2/payments/${id2}/cancel`, {});
  console.log('Pago canceled:', id2);

  const p3 = await v2(
    '/api/v2/payments',
    buildV2PaymentBody({ amount: 20.02, orderId: `3ds-${randomUUID().slice(0, 8)}` }),
  );
  const id3 = p3.payment?.id;
  console.log('Pago requires_action:', id3, `(status=${p3.payment?.status})`);

  const p4 = await v2(
    '/api/v2/payments',
    buildV2PaymentBody({ amount: 15.0, orderId: `auth-${randomUUID().slice(0, 8)}` }),
  );
  const id4 = p4.payment?.id;
  console.log('Pago authorized:', id4, `(status=${p4.payment?.status})`);
}

for (let i = 0; i < bulkExtraCount; i += 1) {
  const idem = randomUUID();
  const amt = randomBulkAmountDecimalEur();
  const created = await v2(
    '/api/v2/payments',
    buildV2PaymentBody({ amount: amt, orderId: `bulk-${randomUUID().slice(0, 8)}` }),
    { 'Idempotency-Key': idem },
  );
  const pid = created.payment?.id;
  if (!pid) fail('Respuesta create sin payment.id (bulk)');
  await sleep(createGapMs);
  await v2(`/api/v2/payments/${pid}/capture`, {});
  if ((i + 1) % 50 === 0 || i + 1 === bulkExtraCount) {
    console.log(`Bulk progreso: ${i + 1}/${bulkExtraCount}`);
  }
}

console.log('');
console.log('Listo. En el backoffice (sesión admin): /transactions — deberías ver estos pagos del merchant', merchant.id);
if (printApiKeyFull) {
  console.log('API key (solo para pruebas curl):', apiKey);
} else {
  const masked = apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '****';
  console.log(
    'API key (enmascarada):',
    masked,
    '(PRINT_DEMO_API_KEY=true o --print-api-key para la clave completa)',
  );
}
