import {
  mergeSkipPrefixes,
  parseSkipPrefixes,
  pathMatchesSkipList,
  redactSensitivePath,
  resolveLoggablePath,
} from './http-logging.interceptor';

describe('HttpLoggingInterceptor path helpers', () => {
  describe('parseSkipPrefixes', () => {
    it('parses comma-separated prefixes and normalizes leading slash', () => {
      expect(parseSkipPrefixes('')).toEqual([]);
      expect(parseSkipPrefixes('  ')).toEqual([]);
      expect(parseSkipPrefixes('/api/v1/pay,/api/v1/webhooks')).toEqual([
        '/api/v1/pay',
        '/api/v1/webhooks',
      ]);
      expect(parseSkipPrefixes('api/v1/pay')).toEqual(['/api/v1/pay']);
    });
  });

  describe('pathMatchesSkipList', () => {
    it('matches exact path or subpaths, not partial segment matches', () => {
      const prefixes = ['/api/v1/webhooks'];
      expect(pathMatchesSkipList('/api/v1/webhooks', prefixes)).toBe(true);
      expect(pathMatchesSkipList('/api/v1/webhooks/inbound', prefixes)).toBe(true);
      expect(pathMatchesSkipList('/api/v1/webhooksx', prefixes)).toBe(false);
      expect(pathMatchesSkipList('/api/v1/pay', prefixes)).toBe(false);
    });
  });

  describe('redactSensitivePath', () => {
    it('redacts paths under /api/v1/pay/*', () => {
      expect(redactSensitivePath('/api/v1/pay/secret-slug')).toBe('/api/v1/pay/[redacted]');
      expect(redactSensitivePath('/api/v1/pay/secret/sub')).toBe('/api/v1/pay/[redacted]');
    });

    it('does not redact unrelated paths', () => {
      expect(redactSensitivePath('/api/v1/payments/abc')).toBe('/api/v1/payments/abc');
      expect(redactSensitivePath('/api/v1/pay')).toBe('/api/v1/pay');
    });
  });

  describe('resolveLoggablePath', () => {
    it('uses Express route template when route.path is set', () => {
      expect(
        resolveLoggablePath({
          originalUrl: '/api/v1/pay/real-slug',
          baseUrl: '/api/v1/pay',
          route: { path: '/:slug' },
        }),
      ).toBe('/api/v1/pay/:slug');
    });

    it('falls back to redaction when route is missing', () => {
      expect(
        resolveLoggablePath({
          originalUrl: '/api/v1/pay/token123',
        }),
      ).toBe('/api/v1/pay/[redacted]');
    });
  });

  describe('mergeSkipPrefixes', () => {
    it('adds default /api/v1/pay in sandbox and production', () => {
      expect(mergeSkipPrefixes([], 'sandbox')).toEqual(['/api/v1/pay']);
      expect(mergeSkipPrefixes([], 'production')).toEqual(['/api/v1/pay']);
    });

    it('does not add defaults in development', () => {
      expect(mergeSkipPrefixes([], 'development')).toEqual([]);
    });

    it('merges env prefixes with defaults and dedupes', () => {
      expect(mergeSkipPrefixes(['/api/v1/webhooks'], 'production')).toEqual([
        '/api/v1/pay',
        '/api/v1/webhooks',
      ]);
      expect(mergeSkipPrefixes(['/api/v1/pay'], 'production')).toEqual(['/api/v1/pay']);
    });
  });
});
