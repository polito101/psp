#!/usr/bin/env node

const baseUrl = process.env.SMOKE_BASE_URL?.trim();
const internalSecret = process.env.INTERNAL_API_SECRET?.trim();

if (!baseUrl) {
  fail('Missing SMOKE_BASE_URL');
}
if (!internalSecret) {
  fail('Missing INTERNAL_API_SECRET');
}

const metricsUrl = buildValidatedMetricsUrl(baseUrl);
const maxPending = readPositiveInt('READINESS_MAX_WEBHOOK_PENDING', 200);
const maxProcessing = readPositiveInt('READINESS_MAX_WEBHOOK_PROCESSING', 100);
const maxFailed = readPositiveInt('READINESS_MAX_WEBHOOK_FAILED', 100);
const maxOldestPendingMs = readPositiveInt('READINESS_MAX_WEBHOOK_OLDEST_PENDING_MS', 300000);
const maxAttemptPersistFailed = readPositiveInt('READINESS_MAX_ATTEMPT_PERSIST_FAILED', 10);
const minSamplesForFailRate = readPositiveInt('READINESS_MIN_SAMPLES_FOR_FAIL_RATE', 10);
const maxProviderFailRate = readRate('READINESS_MAX_PROVIDER_FAIL_RATE', 0.8);
const allowedOpenCircuits = new Set(
  (process.env.READINESS_ALLOWED_OPEN_CIRCUITS ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0),
);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

let response;
try {
  response = await fetch(metricsUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'X-Internal-Secret': internalSecret,
      'X-Backoffice-Role': 'admin',
    },
    signal: controller.signal,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Ops metrics request failed: ${message}`);
} finally {
  clearTimeout(timeout);
}

if (response.status >= 300 && response.status < 400) {
  const location = response.headers.get('location') ?? '<missing>';
  fail(
    `Ops metrics endpoint returned redirect (${response.status}) to "${location}". Redirects are not allowed for readiness checks with internal secrets.`,
  );
}

if (!response.ok) {
  const body = await response.text();
  fail(`Ops metrics request failed with status ${response.status}: ${body}`);
}

let snapshot;
try {
  snapshot = await response.json();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`Invalid JSON in ops metrics response: ${message}`);
}

validateSnapshot(snapshot);
console.log('Ops metrics readiness gate OK');

function validateSnapshot(snapshot) {
  if (!isRecord(snapshot)) {
    fail('Ops metrics payload must be an object');
  }

  const webhooks = snapshot.webhooks;
  const circuitBreakers = snapshot.circuitBreakers;
  const payments = snapshot.payments;

  if (!isRecord(webhooks) || !isRecord(webhooks.counts)) {
    fail('Ops metrics payload missing webhooks.counts');
  }
  if (!isRecord(circuitBreakers)) {
    fail('Ops metrics payload missing circuitBreakers');
  }
  if (!isRecord(payments)) {
    fail('Ops metrics payload missing payments');
  }

  const pending = readNumber(webhooks.counts.pending, 'webhooks.counts.pending');
  const processing = readNumber(webhooks.counts.processing, 'webhooks.counts.processing');
  const failed = readNumber(webhooks.counts.failed, 'webhooks.counts.failed');
  const oldestPendingAgeMs = webhooks.oldestPendingAgeMs;

  if (pending > maxPending) {
    fail(`Webhook pending backlog too high: ${pending} > ${maxPending}`);
  }
  if (processing > maxProcessing) {
    fail(`Webhook processing backlog too high: ${processing} > ${maxProcessing}`);
  }
  if (failed > maxFailed) {
    fail(`Webhook failed backlog too high: ${failed} > ${maxFailed}`);
  }
  if (oldestPendingAgeMs !== null) {
    const oldest = readNumber(oldestPendingAgeMs, 'webhooks.oldestPendingAgeMs');
    if (oldest > maxOldestPendingMs) {
      fail(`Oldest pending webhook too old: ${oldest}ms > ${maxOldestPendingMs}ms`);
    }
  }

  for (const [provider, cb] of Object.entries(circuitBreakers)) {
    if (!isRecord(cb)) {
      fail(`Circuit breaker payload for provider "${provider}" must be an object`);
    }
    const isOpen = Boolean(cb.open);
    if (isOpen && !allowedOpenCircuits.has(provider)) {
      fail(`Circuit breaker for provider "${provider}" is open`);
    }
  }

  for (const [metricKey, metric] of Object.entries(payments)) {
    if (!isRecord(metric)) continue;
    const total = readNumber(metric.total, `${metricKey}.total`);
    const successRate = readNumber(metric.successRate, `${metricKey}.successRate`);
    const attemptPersistFailed = readNumber(
      metric.attemptPersistFailed ?? 0,
      `${metricKey}.attemptPersistFailed`,
    );
    if (attemptPersistFailed > maxAttemptPersistFailed) {
      fail(
        `Too many attemptPersistFailed for "${metricKey}": ${attemptPersistFailed} > ${maxAttemptPersistFailed}`,
      );
    }
    if (total >= minSamplesForFailRate) {
      const failRate = 1 - successRate;
      if (failRate > maxProviderFailRate) {
        fail(
          `Provider fail rate too high for "${metricKey}": ${failRate.toFixed(4)} > ${maxProviderFailRate}`,
        );
      }
    }
  }
}

function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${name} must be a positive integer`);
  }
  return parsed;
}

function readRate(name, fallback) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail(`${name} must be a number between 0 and 1`);
  }
  return parsed;
}

function readNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildValidatedMetricsUrl(rawBaseUrl) {
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    fail(
      'SMOKE_BASE_URL is invalid. Expected an absolute URL (e.g. https://example.com or http://localhost:3000).',
    );
  }

  const isLocalhostException =
    parsedBaseUrl.hostname === 'localhost' ||
    parsedBaseUrl.hostname === '127.0.0.1' ||
    parsedBaseUrl.hostname === '::1';

  if (parsedBaseUrl.protocol !== 'https:' && !(parsedBaseUrl.protocol === 'http:' && isLocalhostException)) {
    fail(
      `Refusing SMOKE_BASE_URL with protocol "${parsedBaseUrl.protocol}". Use https, or http only for localhost/127.0.0.1.`,
    );
  }

  return new URL('/api/v2/payments/ops/metrics', parsedBaseUrl.origin).toString();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
