jest.mock('node:dns/promises', () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

import { resolve4, resolve6 } from 'node:dns/promises';
import {
  assertSafeMerchantNotificationOutboundUrl,
  assertSafeMerchantNotificationResendUrl,
  assertStructuralMerchantCallbackUrl,
} from './merchant-notification-url.policy';

describe('assertStructuralMerchantCallbackUrl / assertSafeMerchantNotificationResendUrl', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSandboxHttp = process.env.PSP_ALLOW_HTTP_MERCHANT_CALLBACKS;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSandboxHttp === undefined) {
      delete process.env.PSP_ALLOW_HTTP_MERCHANT_CALLBACKS;
    } else {
      process.env.PSP_ALLOW_HTTP_MERCHANT_CALLBACKS = originalSandboxHttp;
    }
  });

  it('accepts public https URLs', () => {
    process.env.NODE_ENV = 'test';
    const u = assertStructuralMerchantCallbackUrl('https://example.com/webhook');
    expect(u.hostname).toBe('example.com');
    expect(assertSafeMerchantNotificationResendUrl('https://example.com/webhook').hostname).toBe('example.com');
  });

  it('allows http loopback in non-production', () => {
    process.env.NODE_ENV = 'test';
    const u = assertStructuralMerchantCallbackUrl('http://127.0.0.1:4000/hook');
    expect(u.hostname).toBe('127.0.0.1');
  });

  it('allows http localhost hostname in non-production', () => {
    process.env.NODE_ENV = 'test';
    const u = assertStructuralMerchantCallbackUrl('http://localhost:3000/hook');
    expect(u.hostname).toBe('localhost');
  });

  it('allows http non-loopback when PSP_ALLOW_HTTP_MERCHANT_CALLBACKS=true', () => {
    process.env.NODE_ENV = 'test';
    process.env.PSP_ALLOW_HTTP_MERCHANT_CALLBACKS = 'true';
    expect(() => assertStructuralMerchantCallbackUrl('http://example.com/hook')).not.toThrow();
  });

  it('rejects http non-loopback in non-production without sandbox flag', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PSP_ALLOW_HTTP_MERCHANT_CALLBACKS;
    expect(() => assertStructuralMerchantCallbackUrl('http://example.com/hook')).toThrow();
  });

  it('rejects private IPv4 literals', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertStructuralMerchantCallbackUrl('https://10.0.0.1/hook')).toThrow();
  });

  it('rejects single-label hostnames in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertStructuralMerchantCallbackUrl('https://internal/webhook')).toThrow();
  });

  it('requires https in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertStructuralMerchantCallbackUrl('http://127.0.0.1/hook')).toThrow();
    expect(() => assertStructuralMerchantCallbackUrl('https://127.0.0.1/hook')).toThrow();
    expect(() => assertStructuralMerchantCallbackUrl('https://example.com/hook')).not.toThrow();
  });

  it('rejects URL credentials', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertStructuralMerchantCallbackUrl('https://user:pass@example.com/hook')).toThrow();
  });
});

describe('assertSafeMerchantNotificationOutboundUrl', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.mocked(resolve4).mockReset();
    jest.mocked(resolve6).mockReset();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('accepts hostname that resolves only to a public IPv4 address', async () => {
    jest.mocked(resolve4).mockResolvedValue(['1.1.1.1']);
    jest.mocked(resolve6).mockRejectedValue(Object.assign(new Error('none'), { code: 'ENODATA' }));
    const u = await assertSafeMerchantNotificationOutboundUrl('https://hooks.example.com/notify');
    expect(u.hostname).toBe('hooks.example.com');
  });

  it('rejects hostname that resolves to a private IPv4 address', async () => {
    jest.mocked(resolve4).mockResolvedValue(['10.0.0.2']);
    jest.mocked(resolve6).mockRejectedValue(Object.assign(new Error('none'), { code: 'ENODATA' }));
    await expect(assertSafeMerchantNotificationOutboundUrl('https://evil.example/h')).rejects.toThrow();
  });

  it('rejects hostname with no DNS records', async () => {
    jest.mocked(resolve4).mockRejectedValue(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
    jest.mocked(resolve6).mockRejectedValue(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }));
    await expect(assertSafeMerchantNotificationOutboundUrl('https://missing.example/h')).rejects.toThrow();
  });
});
