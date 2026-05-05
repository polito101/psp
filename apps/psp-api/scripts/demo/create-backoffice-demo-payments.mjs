#!/usr/bin/env node
/**
 * Crea un merchant de prueba y varios pagos v2 (mock) para verlos en el backoffice (`/transactions`).
 *
 * Requiere en el servidor: `PAYMENTS_PROVIDER_ORDER` con `mock` primero y `PAYMENTS_V2_ENABLED_MERCHANTS`
 * que incluya al merchant (p. ej. `*` en sandbox).
 *
 * Variables (local o CI):
 * - `DEMO_API_BASE_URL` o `SMOKE_BASE_URL`: origen de la API (p. ej. https://psp-api-xxxx.onrender.com)
 * - `INTERNAL_API_SECRET` o `SMOKE_INTERNAL_API_SECRET`: mismo valor que en la API (`INTERNAL_API_SECRET`)
 * - `PRINT_DEMO_API_KEY=true` o flag `--print-api-key`: imprime la API key completa en stdout (por defecto solo se muestra enmascarada).
 * - Volumen aleatorio (después de los 4 pagos de ejemplo): flag `--bulk-random` o `DEMO_BULK_RANDOM=true`.
 *   Usa `DEMO_BULK_MIN` / `DEMO_BULK_MAX` (default 40 y 10_000): número de flujos create+capture extra.
 *   `DEMO_CREATE_GAP_MS` (default 2100): pausa tras cada POST /api/v2/payments (throttle 30/min en ese endpoint).
 * - `--bulk-only`: solo el bulk aleatorio, sin los 4 pagos de escenarios fijos.
 */

import { randomUUID } from 'node:crypto';

const baseUrlRaw = (process.env.DEMO_API_BASE_URL ?? process.env.SMOKE_BASE_URL ?? '').trim();
const internalSecret = (process.env.INTERNAL_API_SECRET ?? process.env.SMOKE_INTERNAL_API_SECRET ?? '').trim();
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

/** Mock (`mock-provider.adapter`): %7 → requires_action, %13 → failed al crear; %17 → fallo al capture. */
function randomBulkAmountMinor() {
  for (let k = 0; k < 200; k++) {
    const minor = 1000 + Math.floor(Math.random() * 9000);
    if (minor % 7 !== 0 && minor % 13 !== 0 && minor % 17 !== 0) return minor;
  }
  return 1999;
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
  // 1) Flujo éxito + reembolso (aparece refunded)
  const idem1 = randomUUID();
  const p1 = await v2(
    '/api/v2/payments',
    { amountMinor: 1999, currency: 'EUR' },
    { 'Idempotency-Key': idem1 },
  );
  const id1 = p1.payment?.id;
  if (!id1) fail('Respuesta create sin payment.id');
  await v2(`/api/v2/payments/${id1}/capture`, {});
  await v2(`/api/v2/payments/${id1}/refund`, {});
  console.log('Pago refunded:', id1);

  // 2) Cancelado
  const p2 = await v2('/api/v2/payments', { amountMinor: 1999, currency: 'EUR' });
  const id2 = p2.payment?.id;
  await v2(`/api/v2/payments/${id2}/cancel`, {});
  console.log('Pago canceled:', id2);

  // 3) requires_action (mock 3DS)
  const p3 = await v2('/api/v2/payments', { amountMinor: 2002, currency: 'EUR' });
  const id3 = p3.payment?.id;
  console.log('Pago requires_action:', id3, `(status=${p3.payment?.status})`);

  // 4) Solo autorizado (visible en filtros "no capturados")
  const p4 = await v2('/api/v2/payments', { amountMinor: 1500, currency: 'EUR' });
  const id4 = p4.payment?.id;
  console.log('Pago authorized:', id4, `(status=${p4.payment?.status})`);
}

for (let i = 0; i < bulkExtraCount; i += 1) {
  const idem = randomUUID();
  const minor = randomBulkAmountMinor();
  const created = await v2(
    '/api/v2/payments',
    { amountMinor: minor, currency: 'EUR' },
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
  const masked =
    apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '****';
  console.log(
    'API key (enmascarada):',
    masked,
    '(PRINT_DEMO_API_KEY=true o --print-api-key para la clave completa)',
  );
}
