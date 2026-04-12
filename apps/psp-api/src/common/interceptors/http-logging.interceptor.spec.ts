import { parseSkipPrefixes, pathMatchesSkipList } from './http-logging.interceptor';

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
});
