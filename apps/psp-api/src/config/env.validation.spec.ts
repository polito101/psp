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

  it('rechaza combinación de CB/timeout/reintentos que supera el tope Redis de la sonda half-open (300s)', () => {
    expect(() =>
      validateEnv({
        ...minimalEnv(),
        PAYMENTS_PROVIDER_CB_COOLDOWN_MS: '290000',
        PAYMENTS_PROVIDER_TIMEOUT_MS: '8000',
        PAYMENTS_PROVIDER_MAX_RETRIES: '5',
        PAYMENTS_PROVIDER_RETRY_MAX_MS: '3000',
      }),
    ).toThrow(/half-open probe/);
  });
});
