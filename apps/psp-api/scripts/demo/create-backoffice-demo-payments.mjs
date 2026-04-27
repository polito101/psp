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
 */

import { randomUUID } from 'node:crypto';

const baseUrlRaw = (process.env.DEMO_API_BASE_URL ?? process.env.SMOKE_BASE_URL ?? '').trim();
const internalSecret = (process.env.INTERNAL_API_SECRET ?? process.env.SMOKE_INTERNAL_API_SECRET ?? '').trim();
const fetchTimeoutMs = Math.min(
  120_000,
  Math.max(5_000, Number.parseInt(process.env.DEMO_FETCH_TIMEOUT_MS ?? '90000', 10) || 90_000),
);

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

console.log('');
console.log('Listo. En el backoffice (sesión admin): /transactions — deberías ver estos pagos del merchant', merchant.id);
console.log('API key (solo para pruebas curl):', apiKey);
