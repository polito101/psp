import { PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { VERSION_NEUTRAL } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import {
  buildNestRouteTemplate,
  mergeSkipPrefixes,
  parseSkipPrefixes,
  pathMatchesSkipList,
  redactSensitivePath,
  resolveLoggablePath,
  tryExpressRouteTemplate,
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

    it('strips trailing slashes except for root', () => {
      expect(parseSkipPrefixes('/api/v1/webhooks/')).toEqual(['/api/v1/webhooks']);
      expect(parseSkipPrefixes('/api/v1/webhooks///')).toEqual(['/api/v1/webhooks']);
      expect(parseSkipPrefixes('/')).toEqual(['/']);
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

    it('matches subpaths when prefix was configured with a trailing slash', () => {
      const prefixesWithSlash = ['/api/v1/webhooks/'];
      expect(pathMatchesSkipList('/api/v1/webhooks/inbound', prefixesWithSlash)).toBe(true);
      expect(pathMatchesSkipList('/api/v1/webhooks', prefixesWithSlash)).toBe(true);
    });

    it('treats root prefix / as skip-all for absolute paths', () => {
      expect(pathMatchesSkipList('/api/v1/pay', ['/'])).toBe(true);
      expect(pathMatchesSkipList('/', ['/'])).toBe(true);
    });
  });

  describe('redactSensitivePath', () => {
    it('redacts paths under /api/v1/pay/*', () => {
      expect(redactSensitivePath('/api/v1/pay/secret-slug')).toBe('/api/v1/pay/[redacted]');
      expect(redactSensitivePath('/api/v1/pay/secret/sub')).toBe('/api/v1/pay/[redacted]');
    });

    it('redacts other sensitive API subtrees when no template is available', () => {
      expect(redactSensitivePath('/api/v1/payments/pay_1')).toBe('/api/v1/payments/[redacted]');
      expect(redactSensitivePath('/api/v1/payment-links/pl_1')).toBe('/api/v1/payment-links/[redacted]');
      expect(redactSensitivePath('/api/v1/merchants/m_1/rotate-key')).toBe(
        '/api/v1/merchants/[redacted]',
      );
    });

    it('does not redact unrelated paths', () => {
      expect(redactSensitivePath('/api/v1/balance')).toBe('/api/v1/balance');
      expect(redactSensitivePath('/api/v1/pay')).toBe('/api/v1/pay');
    });
  });

  describe('tryExpressRouteTemplate', () => {
    it('returns undefined when route is not set', () => {
      expect(tryExpressRouteTemplate({ originalUrl: '/api/v1/pay/x' })).toBeUndefined();
    });
  });

  describe('resolveLoggablePath', () => {
    it('prefers Express route template when route.path is set', () => {
      expect(
        resolveLoggablePath({
          originalUrl: '/api/v1/pay/real-slug',
          baseUrl: '/api/v1/pay',
          route: { path: '/:slug' },
        }),
      ).toBe('/api/v1/pay/:slug');
    });

    it('uses Nest template when Express template is absent', () => {
      expect(
        resolveLoggablePath(
          { originalUrl: '/api/v1/payments/pay_secret' },
          '/api/v1/payments/:id',
        ),
      ).toBe('/api/v1/payments/:id');
    });

    it('falls back to redaction when no template is available', () => {
      expect(
        resolveLoggablePath({
          originalUrl: '/api/v1/pay/token123',
        }),
      ).toBe('/api/v1/pay/[redacted]');
    });
  });

  describe('buildNestRouteTemplate', () => {
    it('builds versioned API path from metadata', () => {
      class C {
        findOne(): void {}
      }
      Reflect.defineMetadata(PATH_METADATA, 'payments', C);
      Reflect.defineMetadata(VERSION_METADATA, '1', C);
      Reflect.defineMetadata(PATH_METADATA, ':id', C.prototype.findOne);
      const ctx = {
        getClass: () => C,
        getHandler: () => C.prototype.findOne,
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET' }) }),
      } as unknown as ExecutionContext;
      expect(buildNestRouteTemplate(ctx)).toBe('/api/v1/payments/:id');
    });

    it('builds /health without api prefix (VERSION_NEUTRAL + GET)', () => {
      class H {
        getHealth(): void {}
      }
      Reflect.defineMetadata(PATH_METADATA, 'health', H);
      Reflect.defineMetadata(VERSION_METADATA, VERSION_NEUTRAL, H);
      Reflect.defineMetadata(PATH_METADATA, '/', H.prototype.getHealth);
      const ctx = {
        getClass: () => H,
        getHandler: () => H.prototype.getHealth,
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET' }) }),
      } as unknown as ExecutionContext;
      expect(buildNestRouteTemplate(ctx)).toBe('/health');
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
