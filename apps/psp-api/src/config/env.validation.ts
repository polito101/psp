import {
  PaymentProviderName,
  isPaymentProviderName,
  paymentProviderNamesLabel,
} from '../payments-v2/domain/payment-provider-names';

type EnvInput = Record<string, unknown>;

/**
 * Parsea `CORS_ALLOWED_ORIGINS` (lista separada por comas): normaliza cada entrada al
 * origen WHATWG (`scheme://host[:port]`) y deduplica.
 *
 * Rechaza URLs con ruta distinta de `/`, query, hash, userinfo o esquema distinto de http(s).
 *
 * @param raw Valor crudo de la variable (puede ser cadena vacía).
 * @returns Orígenes listos para `enableCors`.
 * @throws {Error} Si alguna entrada no es un origen HTTP(S) válido.
 */
export function parseCorsAllowedOrigins(raw: string): string[] {
  const segments = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const segment of segments) {
    const origin = normalizeCorsOriginEntry(segment);
    if (!seen.has(origin)) {
      seen.add(origin);
      result.push(origin);
    }
  }
  return result;
}

/**
 * Convierte un segmento de lista CORS al string de origen que envía el navegador.
 *
 * @param segment Entrada tras trim (no vacía).
 */
function normalizeCorsOriginEntry(segment: string): string {
  let url: URL;
  try {
    url = new URL(segment);
  } catch {
    throw new Error(`Invalid CORS_ALLOWED_ORIGINS entry (not a valid URL): ${segment}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `CORS_ALLOWED_ORIGINS entry must use http or https scheme: ${segment}`,
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`CORS_ALLOWED_ORIGINS entry must not include userinfo: ${segment}`);
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error(`CORS_ALLOWED_ORIGINS entry must not include query or hash: ${segment}`);
  }
  if (url.pathname !== '/') {
    throw new Error(`CORS_ALLOWED_ORIGINS entry must not include a path: ${segment}`);
  }
  return url.origin;
}

/**
 * Hostnames de loopback para permitir `http:` en `development`/`test`.
 * Node WHATWG URL usa `hostname === '[::1]'` para literales IPv6 con corchetes.
 */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/**
 * Normaliza `MERCHANT_ONBOARDING_BASE_URL`: origen absoluto `https:`, o `http:` solo
 * en `development`/`test` si el host es loopback (`localhost`, `127.0.0.1`, `::1` / `[::1]`).
 *
 * @param raw URL absoluta (p. ej. desde env).
 * @param nodeEnv Valor de `NODE_ENV` ya normalizado.
 * @returns Origen WHATWG (`scheme://host[:port]`).
 * @throws {Error} Si la URL es inválida o el esquema no está permitido.
 */
export function normalizeMerchantOnboardingBaseUrl(raw: string, nodeEnv: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MERCHANT_ONBOARDING_BASE_URL is not a valid URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('MERCHANT_ONBOARDING_BASE_URL must not include userinfo');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('MERCHANT_ONBOARDING_BASE_URL must not include query or hash');
  }
  if (url.pathname !== '/') {
    throw new Error('MERCHANT_ONBOARDING_BASE_URL must be an origin without path (trailing slash only)');
  }
  const isLoopback = isLoopbackHostname(url.hostname);
  const allowHttp =
    (nodeEnv === 'development' || nodeEnv === 'test') && isLoopback && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !allowHttp) {
    throw new Error(
      'MERCHANT_ONBOARDING_BASE_URL must use https, or http only for loopback hosts in development/test',
    );
  }
  return url.origin;
}

/**
 * Normaliza y valida variables de entorno críticas para evitar fallos tardíos.
 *
 * @param input Variables de entorno crudas.
 * @returns Variables normalizadas para `ConfigModule`.
 * @throws {Error} Si falta configuración crítica.
 */
export function validateEnv(input: EnvInput): EnvInput {
  const env = { ...input };

  const requiredVars = ['DATABASE_URL', 'INTERNAL_API_SECRET', 'APP_ENCRYPTION_KEY'];
  for (const key of requiredVars) {
    const value = getString(env[key]);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    env[key] = value;
  }

  const encryptionKey = getString(env.APP_ENCRYPTION_KEY) ?? '';
  if (encryptionKey.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY must be at least 32 characters');
  }

  const nodeEnv = getString(env.NODE_ENV) ?? 'development';
  env.NODE_ENV = nodeEnv;

  const portRaw = getString(env.PORT) ?? '3000';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be a valid integer between 1 and 65535');
  }
  env.PORT = String(port);

  const swaggerEnabled = parseBoolean(
    getString(env.ENABLE_SWAGGER),
    nodeEnv !== 'production',
    'ENABLE_SWAGGER',
  );
  env.ENABLE_SWAGGER = String(swaggerEnabled);

  const corsAllowedOrigins = getString(env.CORS_ALLOWED_ORIGINS) ?? '';
  env.CORS_ALLOWED_ORIGINS = corsAllowedOrigins;

  if (nodeEnv === 'production' && parseCorsAllowedOrigins(corsAllowedOrigins).length === 0) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS is required in production: set a comma-separated list of allowed origins (e.g. https://app.example.com,https://admin.example.com)',
    );
  }

  const httpLogMode = parseHttpLogMode(getString(env.HTTP_LOG_MODE), nodeEnv);
  env.HTTP_LOG_MODE = httpLogMode;

  const httpLogSampleRate = parseHttpLogSampleRate(getString(env.HTTP_LOG_SAMPLE_RATE));
  env.HTTP_LOG_SAMPLE_RATE = String(httpLogSampleRate);

  const httpLogSkipPrefixes = getString(env.HTTP_LOG_SKIP_PATH_PREFIXES) ?? '';
  env.HTTP_LOG_SKIP_PATH_PREFIXES = httpLogSkipPrefixes;

  env.RESEND_API_KEY = getString(env.RESEND_API_KEY) ?? '';
  env.ONBOARDING_EMAIL_FROM = getString(env.ONBOARDING_EMAIL_FROM) ?? '';
  const merchantOnboardingBaseUrl =
    getString(env.MERCHANT_ONBOARDING_BASE_URL) ?? 'http://localhost:3005';
  env.MERCHANT_ONBOARDING_BASE_URL = normalizeMerchantOnboardingBaseUrl(
    merchantOnboardingBaseUrl,
    nodeEnv,
  );
  env.MERCHANT_ONBOARDING_TOKEN_TTL_HOURS = String(
    parseIntegerRange(
      getString(env.MERCHANT_ONBOARDING_TOKEN_TTL_HOURS),
      168,
      1,
      24 * 30,
      'MERCHANT_ONBOARDING_TOKEN_TTL_HOURS',
    ),
  );

  env.PAYMENTS_V2_ENABLED_MERCHANTS = getString(env.PAYMENTS_V2_ENABLED_MERCHANTS) ?? '';
  env.PAYMENTS_ALLOW_MOCK = String(
    parseBoolean(getString(env.PAYMENTS_ALLOW_MOCK), false, 'PAYMENTS_ALLOW_MOCK'),
  );
  env.PAYMENTS_ACME_ENABLED = String(
    parseBoolean(getString(env.PAYMENTS_ACME_ENABLED), false, 'PAYMENTS_ACME_ENABLED'),
  );
  const defaultProviderOrder = nodeEnv === 'production' ? 'acme' : 'mock';
  const providerOrder = parsePaymentsProviderOrder(
    getString(env.PAYMENTS_PROVIDER_ORDER) ?? defaultProviderOrder,
    {
      nodeEnv,
      allowMockOutsideSandbox:
        nodeEnv === 'development' || nodeEnv === 'sandbox'
          ? true
          : env.PAYMENTS_ALLOW_MOCK === 'true',
    },
  );
  env.PAYMENTS_PROVIDER_ORDER = providerOrder.join(',');
  env.PAYMENTS_PROVIDER_TIMEOUT_MS = String(
    parsePositiveInt(getString(env.PAYMENTS_PROVIDER_TIMEOUT_MS), 8_000, 'PAYMENTS_PROVIDER_TIMEOUT_MS'),
  );
  env.PAYMENTS_PROVIDER_MAX_RETRIES = String(
    parseIntegerRange(getString(env.PAYMENTS_PROVIDER_MAX_RETRIES), 2, 0, 5, 'PAYMENTS_PROVIDER_MAX_RETRIES'),
  );
  env.PAYMENTS_PROVIDER_CB_FAILURES = String(
    parseIntegerRange(getString(env.PAYMENTS_PROVIDER_CB_FAILURES), 3, 1, 20, 'PAYMENTS_PROVIDER_CB_FAILURES'),
  );
  env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS = String(
    parsePositiveInt(
      getString(env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS),
      60_000,
      'PAYMENTS_PROVIDER_CB_COOLDOWN_MS',
    ),
  );
  const halfOpenRaw = getString(env.PAYMENTS_PROVIDER_CB_HALF_OPEN);
  if (halfOpenRaw !== undefined && halfOpenRaw !== 'true' && halfOpenRaw !== 'false') {
    throw new Error('PAYMENTS_PROVIDER_CB_HALF_OPEN must be "true" or "false"');
  }
  env.PAYMENTS_PROVIDER_CB_HALF_OPEN = halfOpenRaw === 'true' ? 'true' : 'false';
  const retryBackoffBaseMs = parseIntegerRange(
    getString(env.PAYMENTS_PROVIDER_RETRY_BASE_MS),
    100,
    0,
    60_000,
    'PAYMENTS_PROVIDER_RETRY_BASE_MS',
  );
  let retryBackoffMaxMs = parsePositiveInt(
    getString(env.PAYMENTS_PROVIDER_RETRY_MAX_MS),
    3000,
    'PAYMENTS_PROVIDER_RETRY_MAX_MS',
  );
  if (retryBackoffMaxMs < retryBackoffBaseMs) {
    retryBackoffMaxMs = retryBackoffBaseMs;
  }
  env.PAYMENTS_PROVIDER_RETRY_BASE_MS = String(retryBackoffBaseMs);
  env.PAYMENTS_PROVIDER_RETRY_MAX_MS = String(retryBackoffMaxMs);

  const maxRetriesForHalfOpenProbe = Number(env.PAYMENTS_PROVIDER_MAX_RETRIES);
  const halfOpenProbeWorstCaseMs =
    Number(env.PAYMENTS_PROVIDER_CB_COOLDOWN_MS) +
    Number(env.PAYMENTS_PROVIDER_TIMEOUT_MS) * (maxRetriesForHalfOpenProbe + 1) +
    Number(env.PAYMENTS_PROVIDER_RETRY_MAX_MS) * maxRetriesForHalfOpenProbe;
  /** Mismo tope que `halfOpenProbeTtlSeconds()` en PaymentsV2Service (cap Redis EX). */
  const PAYMENTS_V2_HALF_OPEN_PROBE_REDIS_TTL_CAP_MS = 300_000;
  const halfOpenProbeRedisRelevant =
    env.PAYMENTS_PROVIDER_CB_HALF_OPEN === 'true' && Boolean(getString(env.REDIS_URL));
  if (
    halfOpenProbeRedisRelevant &&
    halfOpenProbeWorstCaseMs > PAYMENTS_V2_HALF_OPEN_PROBE_REDIS_TTL_CAP_MS
  ) {
    throw new Error(
      `Payments V2 half-open probe uses Redis TTL capped at ${PAYMENTS_V2_HALF_OPEN_PROBE_REDIS_TTL_CAP_MS}ms, but the worst-case provider attempt window is ${halfOpenProbeWorstCaseMs}ms ` +
        `(PAYMENTS_PROVIDER_CB_COOLDOWN_MS + PAYMENTS_PROVIDER_TIMEOUT_MS*(PAYMENTS_PROVIDER_MAX_RETRIES+1) + PAYMENTS_PROVIDER_RETRY_MAX_MS*PAYMENTS_PROVIDER_MAX_RETRIES). ` +
        `Lower those variables so the probe lock TTL is not shorter than the work it protects.`,
    );
  }
  env.PAYMENTS_V2_OPERATION_LOCK_STALE_MS = String(
    parsePositiveInt(
      getString(env.PAYMENTS_V2_OPERATION_LOCK_STALE_MS),
      30_000,
      'PAYMENTS_V2_OPERATION_LOCK_STALE_MS',
    ),
  );

  const merchantRlEnabled = parseBoolean(
    getString(env.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED),
    false,
    'PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED',
  );
  env.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED = String(merchantRlEnabled);
  if (merchantRlEnabled) {
    env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT = String(
      parseStrictPositiveInt(getString(env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT), 'PAYMENTS_V2_MERCHANT_CREATE_LIMIT'),
    );
    env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC = String(
      parseStrictPositiveInt(
        getString(env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC),
        'PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC',
      ),
    );
    normalizeOptionalMerchantRlPair(
      env,
      'PAYMENTS_V2_MERCHANT_CAPTURE_LIMIT',
      'PAYMENTS_V2_MERCHANT_CAPTURE_WINDOW_SEC',
    );
    normalizeOptionalMerchantRlPair(
      env,
      'PAYMENTS_V2_MERCHANT_REFUND_LIMIT',
      'PAYMENTS_V2_MERCHANT_REFUND_WINDOW_SEC',
    );
  } else {
    env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT = getString(env.PAYMENTS_V2_MERCHANT_CREATE_LIMIT) ?? '';
    env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC = getString(env.PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC) ?? '';
    env.PAYMENTS_V2_MERCHANT_CAPTURE_LIMIT = getString(env.PAYMENTS_V2_MERCHANT_CAPTURE_LIMIT) ?? '';
    env.PAYMENTS_V2_MERCHANT_CAPTURE_WINDOW_SEC = getString(env.PAYMENTS_V2_MERCHANT_CAPTURE_WINDOW_SEC) ?? '';
    env.PAYMENTS_V2_MERCHANT_REFUND_LIMIT = getString(env.PAYMENTS_V2_MERCHANT_REFUND_LIMIT) ?? '';
    env.PAYMENTS_V2_MERCHANT_REFUND_WINDOW_SEC = getString(env.PAYMENTS_V2_MERCHANT_REFUND_WINDOW_SEC) ?? '';
  }

  env.PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS = String(
    parseBoolean(
      getString(env.PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS),
      false,
      'PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS',
    ),
  );

  env.FX_ENABLED = String(parseBoolean(getString(env.FX_ENABLED), true, 'FX_ENABLED'));
  env.FX_PROVIDER = (getString(env.FX_PROVIDER) ?? 'frankfurter').toLowerCase();
  if (env.FX_PROVIDER !== 'frankfurter') {
    throw new Error('FX_PROVIDER must be "frankfurter" (extensible later)');
  }
  env.FX_BASE_URL = getString(env.FX_BASE_URL) ?? 'https://api.frankfurter.app';
  env.FX_HTTP_TIMEOUT_MS = String(
    parsePositiveInt(getString(env.FX_HTTP_TIMEOUT_MS), 5000, 'FX_HTTP_TIMEOUT_MS'),
  );
  env.FX_AUTO_REFRESH_ENABLED = String(
    parseBoolean(getString(env.FX_AUTO_REFRESH_ENABLED), true, 'FX_AUTO_REFRESH_ENABLED'),
  );
  env.ONBOARDING_EMAIL_RESEND_FETCH_TIMEOUT_MS = String(
    parseIntegerRange(
      getString(env.ONBOARDING_EMAIL_RESEND_FETCH_TIMEOUT_MS),
      10_000,
      1_000,
      120_000,
      'ONBOARDING_EMAIL_RESEND_FETCH_TIMEOUT_MS',
    ),
  );
  {
    const raw = getString(env.FX_AUTO_REFRESH_INTERVAL_MS);
    const defaultIntervalMs = 6 * 60 * 60 * 1000;
    if (raw === undefined || raw === '') {
      env.FX_AUTO_REFRESH_INTERVAL_MS = String(defaultIntervalMs);
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error('FX_AUTO_REFRESH_INTERVAL_MS must be a non-negative integer (ms, 0 = no periodic refresh)');
      }
      env.FX_AUTO_REFRESH_INTERVAL_MS = String(n);
    }
  }

  if (nodeEnv === 'sandbox') {
    const redisUrl = getString(env.REDIS_URL);
    if (!redisUrl) {
      throw new Error('REDIS_URL is required when NODE_ENV=sandbox');
    }
    env.REDIS_URL = redisUrl;
  }

  env.MERCHANT_ONBOARDING_BASE_URL = normalizeMerchantOnboardingBaseUrl(
    getString(env.MERCHANT_ONBOARDING_BASE_URL) ?? 'http://localhost:3005',
    nodeEnv,
  );

  // Mantener compatibilidad con consumidores que aún lean `process.env` directamente.
  // Importante: `getString()` ya trata "" como unset; aquí reflejamos los valores normalizados.
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) continue;
    process.env[key] = String(value);
  }

  return env;
}

function parseStrictPositiveInt(value: string | undefined, envName: string): number {
  const v = getString(value);
  if (!v) {
    throw new Error(`${envName} is required when PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED=true`);
  }
  const parsed = Number(v);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

/**
 * Si una de las dos variables está definida, exige la otra y normaliza ambas a enteros positivos en `env`.
 */
function normalizeOptionalMerchantRlPair(
  env: EnvInput,
  limitKey: 'PAYMENTS_V2_MERCHANT_CAPTURE_LIMIT' | 'PAYMENTS_V2_MERCHANT_REFUND_LIMIT',
  windowKey: 'PAYMENTS_V2_MERCHANT_CAPTURE_WINDOW_SEC' | 'PAYMENTS_V2_MERCHANT_REFUND_WINDOW_SEC',
): void {
  const lim = getString(env[limitKey]);
  const win = getString(env[windowKey]);
  if (!lim && !win) {
    env[limitKey] = '';
    env[windowKey] = '';
    return;
  }
  if (!lim || !win) {
    throw new Error(`${limitKey} and ${windowKey} must both be set or both unset`);
  }
  env[limitKey] = String(parseStrictPositiveInt(lim, limitKey));
  env[windowKey] = String(parseStrictPositiveInt(win, windowKey));
}

function parsePaymentsProviderOrder(
  raw: string,
  opts: { nodeEnv: string; allowMockOutsideSandbox: boolean },
): PaymentProviderName[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (entries.length === 0) {
    throw new Error(
      `PAYMENTS_PROVIDER_ORDER must contain at least one provider (allowed: ${paymentProviderNamesLabel()})`,
    );
  }

  const seen = new Set<PaymentProviderName>();
  const result: PaymentProviderName[] = [];
  for (const entry of entries) {
    if (!isPaymentProviderName(entry)) {
      throw new Error(
        `PAYMENTS_PROVIDER_ORDER contains an invalid provider: "${entry}" (allowed: ${paymentProviderNamesLabel()})`,
      );
    }
    const name = entry;
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  if (result.length === 0) {
    throw new Error(
      `PAYMENTS_PROVIDER_ORDER must contain at least one provider (allowed: ${paymentProviderNamesLabel()})`,
    );
  }

  if (result.includes('mock') && !opts.allowMockOutsideSandbox) {
    throw new Error(
      `PAYMENTS_PROVIDER_ORDER cannot include "mock" when NODE_ENV=${opts.nodeEnv}. Remove "mock" or set PAYMENTS_ALLOW_MOCK=true explicitly.`,
    );
  }

  return result;
}

function getString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normaliza la URL pública de onboarding a su origin, evitando credenciales
 * embebidas o componentes que puedan mezclarse con tokens del flujo.
 */
function normalizeMerchantOnboardingBaseUrl(value: string, nodeEnv: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MERCHANT_ONBOARDING_BASE_URL must be an absolute URL');
  }

  if (url.username !== '' || url.password !== '') {
    throw new Error('MERCHANT_ONBOARDING_BASE_URL must not include userinfo');
  }

  if (url.search !== '' || url.hash !== '') {
    throw new Error('MERCHANT_ONBOARDING_BASE_URL must not include query or hash');
  }

  if (url.protocol === 'https:') {
    return url.origin;
  }

  const allowsLocalhostHttp = nodeEnv === 'development' || nodeEnv === 'test';
  if (allowsLocalhostHttp && url.protocol === 'http:' && url.hostname === 'localhost') {
    return url.origin;
  }

  throw new Error(
    'MERCHANT_ONBOARDING_BASE_URL must use https (http://localhost is allowed in development and test)',
  );
}

function parseBoolean(value: string | undefined, defaultValue: boolean, envName: string): boolean {
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${envName} must be "true" or "false"`);
}

type HttpLogMode = 'off' | 'all' | 'errors' | 'sample';

/**
 * Modo de log por petición HTTP.
 * Por defecto: `all` fuera de producción; en `production` solo `errors` (4xx/5xx) para reducir ruido y coste.
 */
function parseHttpLogMode(value: string | undefined, nodeEnv: string): HttpLogMode {
  if (value === 'off' || value === 'all' || value === 'errors' || value === 'sample') {
    return value;
  }
  if (value !== undefined && value.trim() !== '') {
    throw new Error('HTTP_LOG_MODE must be one of: off, all, errors, sample');
  }
  return nodeEnv === 'production' ? 'errors' : 'all';
}

function parseHttpLogSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 0.1;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error('HTTP_LOG_SAMPLE_RATE must be a number between 0 and 1');
  }
  return n;
}

function parsePositiveInt(value: string | undefined, defaultValue: number, envName: string): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

function parseIntegerRange(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  envName: string,
): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${envName} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
