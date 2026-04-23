import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type FrankfurterLatestResponse = {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
};

/**
 * Cliente HTTP para Frankfurter (ECB) — sin API key.
 * @see https://www.frankfurter.app/docs
 */
@Injectable()
export class FxProviderClient {
  constructor(private readonly config: ConfigService) {}

  async fetchLatestRate(params: { base: string; quote: string }): Promise<{
    rate: number;
    externalRef: string;
    asOfDate: string;
  }> {
    const enabled = this.config.get<string>('FX_ENABLED') === 'true';
    if (!enabled) {
      throw new Error('FX is disabled (FX_ENABLED=false)');
    }
    const baseUrl = this.config.get<string>('FX_BASE_URL') ?? 'https://api.frankfurter.app';
    const timeoutMs = Number(this.config.get<string>('FX_HTTP_TIMEOUT_MS') ?? '5000');
    const base = params.base.toUpperCase();
    const quote = params.quote.toUpperCase();
    if (base === quote) {
      return { rate: 1, externalRef: 'identity', asOfDate: new Date().toISOString().slice(0, 10) };
    }
    const url = `${baseUrl.replace(/\/$/, '')}/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw new Error(`Frankfurter HTTP ${res.status}`);
      }
      const body = (await res.json()) as FrankfurterLatestResponse;
      const rate = body.rates[quote];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Frankfurter missing rate for ${base}→${quote}`);
      }
      return {
        rate,
        externalRef: `frankfurter:${body.date}:${base}:${quote}`,
        asOfDate: body.date,
      };
    } finally {
      clearTimeout(t);
    }
  }
}
