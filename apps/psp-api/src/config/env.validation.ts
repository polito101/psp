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

  const swaggerEnabled = parseBoolean(getString(env.ENABLE_SWAGGER), nodeEnv !== 'production');
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

  env.PAYMENTS_V2_ENABLED_MERCHANTS = getString(env.PAYMENTS_V2_ENABLED_MERCHANTS) ?? '';
  env.PAYMENTS_ALLOW_MOCK = String(parseBoolean(getString(env.PAYMENTS_ALLOW_MOCK), false));
  const defaultProviderOrder = nodeEnv === 'production' ? 'stripe' : 'stripe,mock';
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
  env.STRIPE_SECRET_KEY = getString(env.STRIPE_SECRET_KEY) ?? '';
  env.STRIPE_API_BASE_URL = validateStripeApiBaseUrl(getString(env.STRIPE_API_BASE_URL));
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
  env.PAYMENTS_V2_OPERATION_LOCK_STALE_MS = String(
    parsePositiveInt(
      getString(env.PAYMENTS_V2_OPERATION_LOCK_STALE_MS),
      30_000,
      'PAYMENTS_V2_OPERATION_LOCK_STALE_MS',
    ),
  );

  if (nodeEnv === 'sandbox') {
    const redisUrl = getString(env.REDIS_URL);
    if (!redisUrl) {
      throw new Error('REDIS_URL is required when NODE_ENV=sandbox');
    }
    env.REDIS_URL = redisUrl;
  }

  // Mantener compatibilidad con consumidores que aún lean `process.env` directamente.
  // Importante: `getString()` ya trata "" como unset; aquí reflejamos los valores normalizados.
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) continue;
    process.env[key] = String(value);
  }

  return env;
}

type PaymentsProviderName = 'stripe' | 'mock';

function parsePaymentsProviderOrder(
  raw: string,
  opts: { nodeEnv: string; allowMockOutsideSandbox: boolean },
): PaymentsProviderName[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (entries.length === 0) {
    throw new Error(
      'PAYMENTS_PROVIDER_ORDER must contain at least one provider: stripe or mock',
    );
  }

  const seen = new Set<PaymentsProviderName>();
  const result: PaymentsProviderName[] = [];
  for (const entry of entries) {
    if (entry !== 'stripe' && entry !== 'mock') {
      throw new Error(
        `PAYMENTS_PROVIDER_ORDER contains an invalid provider: "${entry}" (allowed: stripe,mock)`,
      );
    }
    const name = entry as PaymentsProviderName;
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  if (result.length === 0) {
    throw new Error(
      'PAYMENTS_PROVIDER_ORDER must contain at least one provider: stripe or mock',
    );
  }

  if (result.includes('mock') && !opts.allowMockOutsideSandbox) {
    throw new Error(
      `PAYMENTS_PROVIDER_ORDER cannot include "mock" when NODE_ENV=${opts.nodeEnv}. Remove "mock" or set PAYMENTS_ALLOW_MOCK=true explicitly.`,
    );
  }

  return result;
}

/**
 * Valida y normaliza el base URL de Stripe para evitar exfiltración accidental del token Bearer
 * hacia hosts arbitrarios.
 *
 * Reglas:
 * - protocolo: https
 * - host: api.stripe.com
 * - base path: /v1 (se acepta /v1/ y se normaliza)
 * - sin userinfo, query ni hash
 *
 * @returns siempre `https://api.stripe.com/v1`
 * @throws {Error} si el valor configurado no es seguro
 */
function validateStripeApiBaseUrl(raw: string | undefined): string {
  const DEFAULT = 'https://api.stripe.com/v1';
  if (raw === undefined || raw.trim() === '') return DEFAULT;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('STRIPE_API_BASE_URL must be a valid https URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('STRIPE_API_BASE_URL must use https scheme');
  }
  if (url.host !== 'api.stripe.com') {
    throw new Error('STRIPE_API_BASE_URL host must be exactly api.stripe.com');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('STRIPE_API_BASE_URL must not include userinfo');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('STRIPE_API_BASE_URL must not include query or hash');
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (normalizedPath !== '/v1') {
    throw new Error('STRIPE_API_BASE_URL path must be exactly /v1');
  }

  return DEFAULT;
}

function getString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('ENABLE_SWAGGER must be "true" or "false"');
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
