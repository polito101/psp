import { BadRequestException } from '@nestjs/common';
import { resolve4, resolve6 } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

/** Hostnames that must never receive server-side webhook-style POST from the PSP (SSRF/abuse guard). */
const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal', 'metadata.goog', 'metadata.google']);

function ipv4Octets(host: string): [number, number, number, number] | null {
  if (!isIPv4(host)) return null;
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const n = parts.map((p) => Number(p));
  if (n.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return null;
  return [n[0]!, n[1]!, n[2]!, n[3]!];
}

function isNonPublicIpv4Literal(host: string): boolean {
  const o = ipv4Octets(host);
  if (!o) return false;
  const [a, b] = o;

  // Loopback / RFC1918 / link-local CGNAT-ish blocks commonly abused for SSRF
  if (a === 0 || a === 10 || a === 127 || (a >= 224 && a <= 255)) return true;
  if (a === 169 && b === 254) return true; // IPv4 link-local
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10

  return false;
}

function isNonPublicIpv6Literal(host: string): boolean {
  const mapped = ipv4EmbeddedInIpv6Literal(host);
  if (mapped && isNonPublicIpv4Literal(mapped)) return true;

  if (!isIPv6(host)) return false;
  const h = host.toLowerCase();
  if (h === '::1') return true;
  if (h.startsWith('fe80:')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
  return false;
}

/** Strip zone id (`fe80::1%eth0` → `fe80::1`) for classification only. */
function stripIpv6Zone(host: string): string {
  const pct = host.indexOf('%');
  return pct === -1 ? host : host.slice(0, pct);
}

/** If `host` is IPv6 literal embedding IPv4 (incl. ::ffff:a.b.c.d), return the IPv4 part. */
function ipv4EmbeddedInIpv6Literal(host: string): string | null {
  const z = stripIpv6Zone(host);
  const lower = z.toLowerCase();
  const mappedFf = '::ffff:';
  if (lower.startsWith(mappedFf)) {
    const tail = z.slice(mappedFf.length);
    return isIPv4(tail) ? tail : null;
  }
  const mappedLong = '0:0:0:0:0:ffff:';
  const idx = lower.lastIndexOf(mappedLong);
  if (idx !== -1) {
    const tail = z.slice(idx + mappedLong.length);
    return isIPv4(tail) ? tail : null;
  }
  return null;
}

/** Literal loopback IPs allowed for `http` only in non-production (local DX). Hostname `localhost` is handled separately. */
function isDevHttpLoopbackIpLiteral(host: string): boolean {
  const o = ipv4Octets(host);
  if (o) return o[0] === 127;
  const z = stripIpv6Zone(host).toLowerCase();
  return isIPv6(host) && z === '::1';
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

function allowHttpNonLoopbackSandbox(): boolean {
  return !isProductionEnv() && process.env.PSP_ALLOW_HTTP_MERCHANT_CALLBACKS === 'true';
}

export function assertResolvedIpIsPublicForMerchantFetch(ip: string): void {
  const trimmed = ip.trim();
  const mapped4 = ipv4EmbeddedInIpv6Literal(trimmed);
  if (mapped4) {
    if (isNonPublicIpv4Literal(mapped4)) {
      throw new BadRequestException({
        message: 'notification URL resolves to non-public addresses',
        reasonCode: 'blocked_notification_url',
      });
    }
    return;
  }
  if (isIPv4(trimmed)) {
    if (isNonPublicIpv4Literal(trimmed)) {
      throw new BadRequestException({
        message: 'notification URL resolves to non-public addresses',
        reasonCode: 'blocked_notification_url',
      });
    }
    return;
  }
  if (isIPv6(trimmed)) {
    if (isNonPublicIpv6Literal(trimmed)) {
      throw new BadRequestException({
        message: 'notification URL resolves to non-public addresses',
        reasonCode: 'blocked_notification_url',
      });
    }
    return;
  }

  throw new BadRequestException({
    message: 'notification URL resolves to an unrecognized address',
    reasonCode: 'blocked_notification_url',
  });
}

async function resolveAllPublicAddressesOrThrow(hostname: string): Promise<void> {
  const ips = new Set<string>();
  const ignorable = new Set(['ENOTFOUND', 'ENODATA']);

  try {
    for (const ip of await resolve4(hostname)) ips.add(ip);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (!code || !ignorable.has(code)) {
      throw new BadRequestException({
        message: 'notification URL hostname could not be resolved',
        reasonCode: 'invalid_notification_url',
      });
    }
  }

  try {
    for (const ip of await resolve6(hostname)) ips.add(ip);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (!code || !ignorable.has(code)) {
      throw new BadRequestException({
        message: 'notification URL hostname could not be resolved',
        reasonCode: 'invalid_notification_url',
      });
    }
  }

  if (ips.size === 0) {
    throw new BadRequestException({
      message: 'notification URL hostname does not resolve to any address',
      reasonCode: 'invalid_notification_url',
    });
  }

  for (const ip of ips) {
    assertResolvedIpIsPublicForMerchantFetch(ip);
  }
}

/**
 * Structural validation for merchant callback URLs persisted on payments (`notificationUrl`, `returnUrl`, `cancelUrl`).
 * Does not DNS-resolve hostnames (that happens immediately before server-side fetch on resend).
 */
export function assertStructuralMerchantCallbackUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BadRequestException({ message: 'URL is empty', reasonCode: 'invalid_notification_url' });
  }

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new BadRequestException({ message: 'URL is not valid', reasonCode: 'invalid_notification_url' });
  }

  if (u.username || u.password) {
    throw new BadRequestException({
      message: 'URL must not include username/password',
      reasonCode: 'invalid_notification_url',
    });
  }

  const host = u.hostname.toLowerCase();
  if (!host) {
    throw new BadRequestException({ message: 'URL must include a hostname', reasonCode: 'invalid_notification_url' });
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new BadRequestException({ message: 'URL hostname is blocked', reasonCode: 'blocked_notification_url' });
  }
  if (host.endsWith('.internal')) {
    throw new BadRequestException({ message: 'URL hostname is blocked', reasonCode: 'blocked_notification_url' });
  }

  const isProd = isProductionEnv();
  const scheme = u.protocol.replace(':', '').toLowerCase();
  const loopbackHostname =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || stripIpv6Zone(host) === '::1';

  if (isProd && (scheme !== 'https' || loopbackHostname)) {
    throw new BadRequestException({
      message: 'URL must be a public HTTPS URL in production',
      reasonCode: 'invalid_notification_url',
    });
  }

  if (!isProd) {
    const sandboxHttp = allowHttpNonLoopbackSandbox();
    if (scheme !== 'http' && scheme !== 'https') {
      throw new BadRequestException({
        message: 'URL must use http or https',
        reasonCode: 'invalid_notification_url',
      });
    }
    if (scheme === 'http' && !loopbackHostname && !sandboxHttp) {
      throw new BadRequestException({
        message:
          'http URLs are only allowed for loopback hosts unless PSP_ALLOW_HTTP_MERCHANT_CALLBACKS=true (non-production)',
        reasonCode: 'invalid_notification_url',
      });
    }
  }

  // Avoid ambiguous/internal-looking single-label names in production (still allows IPv4/IPv6 literals).
  if (isProd && !isIPv4(host) && !isIPv6(host) && !host.includes('.')) {
    throw new BadRequestException({
      message: 'URL hostname must be a fully qualified domain name',
      reasonCode: 'invalid_notification_url',
    });
  }

  // Block obvious private/metadata targets when host is already an IP literal.
  if (isIPv4(host) || isIPv6(host)) {
    const allowDevHttpLoopback = !isProd && scheme === 'http' && isDevHttpLoopbackIpLiteral(stripIpv6Zone(host));
    if (!allowDevHttpLoopback) {
      const bad = isNonPublicIpv4Literal(host) || isNonPublicIpv6Literal(host);
      if (bad) {
        throw new BadRequestException({
          message: 'URL targets a non-public host',
          reasonCode: 'blocked_notification_url',
        });
      }
    }
  }

  return u;
}

/** @deprecated Use assertStructuralMerchantCallbackUrl — kept for tests naming parity */
export const assertSafeMerchantNotificationResendUrl = assertStructuralMerchantCallbackUrl;

/**
 * Full outbound guard for ops resend: structural checks plus DNS resolution so hostname→private IP SSRF is blocked.
 */
export async function assertSafeMerchantNotificationOutboundUrl(raw: string): Promise<URL> {
  const u = assertStructuralMerchantCallbackUrl(raw);
  const host = u.hostname;
  const literalHost = stripIpv6Zone(host);

  if (!isIPv4(literalHost) && !isIPv6(literalHost)) {
    await resolveAllPublicAddressesOrThrow(literalHost);
  }

  return u;
}
