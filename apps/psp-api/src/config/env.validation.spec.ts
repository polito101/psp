import { parseCorsAllowedOrigins, validateEnv } from './env.validation';

describe('parseCorsAllowedOrigins', () => {
  it('normalizes trailing slash to origin', () => {
    expect(parseCorsAllowedOrigins('https://app.example.com/')).toEqual(['https://app.example.com']);
  });

  it('normalizes multiple entries with optional slashes and spaces', () => {
    expect(
      parseCorsAllowedOrigins('https://a.example.com/ , http://localhost:3000 '),
    ).toEqual(['https://a.example.com', 'http://localhost:3000']);
  });

  it('deduplicates after normalization', () => {
    expect(parseCorsAllowedOrigins('https://x.com,https://x.com/')).toEqual(['https://x.com']);
  });

  it('rejects entries with a path', () => {
    expect(() => parseCorsAllowedOrigins('https://app.example.com/api')).toThrow(
      /must not include a path/,
    );
  });

  it('rejects entries with query', () => {
    expect(() => parseCorsAllowedOrigins('https://app.example.com?x=1')).toThrow(
      /must not include query or hash/,
    );
  });

  it('rejects entries with hash', () => {
    expect(() => parseCorsAllowedOrigins('https://app.example.com#frag')).toThrow(
      /must not include query or hash/,
    );
  });

  it('rejects invalid URL strings', () => {
    expect(() => parseCorsAllowedOrigins('not-a-url')).toThrow(/not a valid URL/);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => parseCorsAllowedOrigins('ftp://files.example.com')).toThrow(/http or https/);
  });

  it('returns empty array for empty or whitespace-only input', () => {
    expect(parseCorsAllowedOrigins('')).toEqual([]);
    expect(parseCorsAllowedOrigins('  ,  , ')).toEqual([]);
  });
});

describe('validateEnv payments provider retry backoff', () => {
  const minimalEnv = (): Record<string, string> => ({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    INTERNAL_API_SECRET: 'internal-secret',
    APP_ENCRYPTION_KEY: '01234567890123456789012345678901',
    NODE_ENV: 'development',
  });

  it('expone PAYMENTS_PROVIDER_RETRY_BASE_MS y PAYMENTS_PROVIDER_RETRY_MAX_MS normalizados', () => {
    const out = validateEnv({
      ...minimalEnv(),
      PAYMENTS_PROVIDER_RETRY_BASE_MS: '200',
      PAYMENTS_PROVIDER_RETRY_MAX_MS: '4000',
    });
    expect(out.PAYMENTS_PROVIDER_RETRY_BASE_MS).toBe('200');
    expect(out.PAYMENTS_PROVIDER_RETRY_MAX_MS).toBe('4000');
  });

  it('sube PAYMENTS_PROVIDER_RETRY_MAX_MS hasta BASE si MAX < BASE', () => {
    const out = validateEnv({
      ...minimalEnv(),
      PAYMENTS_PROVIDER_RETRY_BASE_MS: '500',
      PAYMENTS_PROVIDER_RETRY_MAX_MS: '100',
    });
    expect(out.PAYMENTS_PROVIDER_RETRY_BASE_MS).toBe('500');
    expect(out.PAYMENTS_PROVIDER_RETRY_MAX_MS).toBe('500');
  });

  it('normaliza PAYMENTS_PROVIDER_CB_HALF_OPEN (default false)', () => {
    const out = validateEnv({ ...minimalEnv() });
    expect(out.PAYMENTS_PROVIDER_CB_HALF_OPEN).toBe('false');
  });

  it('acepta PAYMENTS_PROVIDER_CB_HALF_OPEN=true', () => {
    const out = validateEnv({
      ...minimalEnv(),
      PAYMENTS_PROVIDER_CB_HALF_OPEN: 'true',
    });
    expect(out.PAYMENTS_PROVIDER_CB_HALF_OPEN).toBe('true');
  });

  it('rechaza PAYMENTS_PROVIDER_CB_HALF_OPEN inválido', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_PROVIDER_CB_HALF_OPEN: 'yes',
      }),
    ).toThrow(/PAYMENTS_PROVIDER_CB_HALF_OPEN/);
  });

  it('rechaza PAYMENTS_PROVIDER_ORDER con código de proveedor desconocido', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_PROVIDER_ORDER: 'mock,unknownpsp',
      }),
    ).toThrow(/invalid provider/);
  });

  it('acepta PAYMENTS_PROVIDER_ORDER con acme en development', () => {
    const out = validateEnv({
      ...minimalEnv(),
      NODE_ENV: 'development',
      PAYMENTS_PROVIDER_ORDER: 'mock,acme',
    });
    expect(out.PAYMENTS_PROVIDER_ORDER).toBe('mock,acme');
  });

  it('no rechaza ventana >300s si la sonda half-open Redis no aplica (half-open desactivado por defecto)', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_PROVIDER_CB_COOLDOWN_MS: '290000',
        PAYMENTS_PROVIDER_TIMEOUT_MS: '8000',
        PAYMENTS_PROVIDER_MAX_RETRIES: '5',
        PAYMENTS_PROVIDER_RETRY_MAX_MS: '3000',
      }),
    ).not.toThrow();
  });

  it('no rechaza ventana >300s con half-open activo si no hay REDIS_URL (sin sonda distribuida)', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_PROVIDER_CB_HALF_OPEN: 'true',
        PAYMENTS_PROVIDER_CB_COOLDOWN_MS: '290000',
        PAYMENTS_PROVIDER_TIMEOUT_MS: '8000',
        PAYMENTS_PROVIDER_MAX_RETRIES: '5',
        PAYMENTS_PROVIDER_RETRY_MAX_MS: '3000',
      }),
    ).not.toThrow();
  });

  it('rechaza ventana >300s cuando half-open Redis aplica (flag true y REDIS_URL)', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        REDIS_URL: 'redis://localhost:6379',
        PAYMENTS_PROVIDER_CB_HALF_OPEN: 'true',
        PAYMENTS_PROVIDER_CB_COOLDOWN_MS: '290000',
        PAYMENTS_PROVIDER_TIMEOUT_MS: '8000',
        PAYMENTS_PROVIDER_MAX_RETRIES: '5',
        PAYMENTS_PROVIDER_RETRY_MAX_MS: '3000',
      }),
    ).toThrow(/half-open probe/);
  });
});

describe('validateEnv payments v2 merchant rate limit', () => {
  const minimalEnv = (): Record<string, string> => ({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    INTERNAL_API_SECRET: 'internal-secret',
    APP_ENCRYPTION_KEY: '01234567890123456789012345678901',
    NODE_ENV: 'development',
  });

  it('con flag desactivado no exige limites de create', () => {
    const out = validateEnv({
      ...minimalEnv(),
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'false',
    });
    expect(out.PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED).toBe('false');
  });

  it('con flag activo exige CREATE_LIMIT y CREATE_WINDOW_SEC', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      }),
    ).toThrow(/PAYMENTS_V2_MERCHANT_CREATE_LIMIT/);
  });

  it('normaliza create y pares opcionales capture/refund', () => {
    const out = validateEnv({
      ...minimalEnv(),
      PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
      PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '30',
      PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '10',
      PAYMENTS_V2_MERCHANT_CAPTURE_LIMIT: '5',
      PAYMENTS_V2_MERCHANT_CAPTURE_WINDOW_SEC: '120',
      PAYMENTS_V2_MERCHANT_REFUND_LIMIT: '3',
      PAYMENTS_V2_MERCHANT_REFUND_WINDOW_SEC: '60',
    });
    expect(out.PAYMENTS_V2_MERCHANT_CREATE_LIMIT).toBe('30');
    expect(out.PAYMENTS_V2_MERCHANT_CAPTURE_LIMIT).toBe('5');
    expect(out.PAYMENTS_V2_MERCHANT_REFUND_WINDOW_SEC).toBe('60');
  });

  it('rechaza par capture incompleto', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_V2_MERCHANT_RATE_LIMIT_ENABLED: 'true',
        PAYMENTS_V2_MERCHANT_CREATE_LIMIT: '1',
        PAYMENTS_V2_MERCHANT_CREATE_WINDOW_SEC: '1',
        PAYMENTS_V2_MERCHANT_CAPTURE_LIMIT: '5',
      }),
    ).toThrow(/PAYMENTS_V2_MERCHANT_CAPTURE_WINDOW_SEC/);
  });

  it('rechaza PAYMENTS_ALLOW_MOCK inválido citando el nombre de variable', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_ALLOW_MOCK: 'yes',
      }),
    ).toThrow(/PAYMENTS_ALLOW_MOCK must be "true" or "false"/);
  });
});

describe('validateEnv PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS', () => {
  const minimalEnv = (): Record<string, string> => ({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    INTERNAL_API_SECRET: 'internal-secret',
    APP_ENCRYPTION_KEY: '01234567890123456789012345678901',
    NODE_ENV: 'development',
  });

  it('normaliza a false por defecto', () => {
    const out = validateEnv({ ...minimalEnv() });
    expect(out.PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS).toBe('false');
  });

  it('acepta true', () => {
    const out = validateEnv({
      ...minimalEnv(),
      PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS: 'true',
    });
    expect(out.PAYMENTS_V2_ASSERT_NO_LEGACY_STRIPE_ROWS).toBe('true');
  });
});

describe('validateEnv merchant onboarding', () => {
  const minimalEnv = (): Record<string, string> => ({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    INTERNAL_API_SECRET: 'internal-secret',
    APP_ENCRYPTION_KEY: '01234567890123456789012345678901',
    NODE_ENV: 'development',
  });

  it('normaliza onboarding base URL al origin', () => {
    const out = validateEnv({
      ...minimalEnv(),
      MERCHANT_ONBOARDING_BASE_URL: 'https://backoffice.example.com/onboarding',
    });

    expect(out.MERCHANT_ONBOARDING_BASE_URL).toBe('https://backoffice.example.com');
  });

  it('acepta el default localhost en NODE_ENV=test', () => {
    const out = validateEnv({
      ...minimalEnv(),
      NODE_ENV: 'test',
      PAYMENTS_PROVIDER_ORDER: 'acme',
    });

    expect(out.MERCHANT_ONBOARDING_BASE_URL).toBe('http://localhost:3005');
  });

  it('rechaza onboarding base URL con userinfo', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        MERCHANT_ONBOARDING_BASE_URL: 'https://user:pass@backoffice.example.com',
      }),
    ).toThrow(/must not include userinfo/);
  });

  it('rechaza onboarding base URL con query o hash', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        MERCHANT_ONBOARDING_BASE_URL: 'https://backoffice.example.com?token=secret',
      }),
    ).toThrow(/must not include query or hash/);

    expect(() =>
      validateEnv({
        ...minimalEnv(),
        MERCHANT_ONBOARDING_BASE_URL: 'https://backoffice.example.com#secret',
      }),
    ).toThrow(/must not include query or hash/);
  });
});
