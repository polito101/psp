import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FxProviderClient } from './fx-provider.client';
import { getIso4217MinorExponent, USD_MINOR_EXPONENT } from './iso4217-minor-exponent';

export type FxConversionResult =
  | { ok: true; usdMinor: number; snapshotId: string; rateDecimal: string }
  | { ok: false; conversionUnavailable: true; reason: string };

@Injectable()
export class FxRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fxClient: FxProviderClient,
  ) {}

  /**
   * Persiste un snapshot de tipo de cambio (1 base = rateDecimal quote).
   */
  async refreshAndPersistSnapshot(params: {
    baseCurrency: string;
    quoteCurrency: string;
    effectiveAt?: Date;
  }): Promise<{ id: string; rateDecimal: string; effectiveAt: Date }> {
    const base = params.baseCurrency.toUpperCase();
    const quote = params.quoteCurrency.toUpperCase();
    const effectiveAt = params.effectiveAt ?? new Date();
    const { rate, externalRef, asOfDate } = await this.fxClient.fetchLatestRate({ base, quote });
    const rateDecimal = new Prisma.Decimal(rate);
    const row = await this.prisma.fxRateSnapshot.create({
      data: {
        baseCurrency: base,
        quoteCurrency: quote,
        rateDecimal,
        effectiveAt: new Date(`${asOfDate}T12:00:00.000Z`),
        source: 'frankfurter',
        externalRef,
      },
    });
    return {
      id: row.id,
      rateDecimal: row.rateDecimal.toString(),
      effectiveAt: row.effectiveAt,
    };
  }

  async getLatestSnapshot(baseCurrency: string, quoteCurrency: string) {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    return this.prisma.fxRateSnapshot.findFirst({
      where: { baseCurrency: base, quoteCurrency: quote },
      orderBy: { effectiveAt: 'desc' },
    });
  }

  /**
   * Snapshot más reciente con effectiveAt <= `at` (reporting histórico).
   */
  async getSnapshotAtOrBefore(baseCurrency: string, quoteCurrency: string, at: Date) {
    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    return this.prisma.fxRateSnapshot.findFirst({
      where: {
        baseCurrency: base,
        quoteCurrency: quote,
        effectiveAt: { lte: at },
      },
      orderBy: { effectiveAt: 'desc' },
    });
  }

  /**
   * Snapshots EUR→USD (y otras bases) vigentes a `at`, una fila por moneda base (PostgreSQL DISTINCT ON).
   * No incluye USD como base (no hay fila en tabla para eso).
   */
  async getUsdSnapshotsAtOrBeforeForBases(
    baseCurrencies: string[],
    at: Date,
  ): Promise<Map<string, { id: string; rateDecimal: Prisma.Decimal }>> {
    const bases = [...new Set(baseCurrencies.map((c) => c.toUpperCase()))].filter((b) => b !== 'USD');
    const out = new Map<string, { id: string; rateDecimal: Prisma.Decimal }>();
    if (bases.length === 0) {
      return out;
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ base_currency: string; id: string; rate_decimal: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT DISTINCT ON ("base_currency") "base_currency", "id", "rate_decimal"
      FROM "FxRateSnapshot"
      WHERE "quote_currency" = 'USD'
        AND "base_currency" IN (${Prisma.join(bases)})
        AND "effective_at" <= ${at}
      ORDER BY "base_currency", "effective_at" DESC
    `);

    for (const r of rows) {
      out.set(r.base_currency.toUpperCase(), {
        id: r.id,
        rateDecimal: r.rate_decimal,
      });
    }
    return out;
  }

  private finalizeMinorToUsdFromLoadedNonUsdSnapshot(params: {
    amountMinor: number;
    baseCurrency: string;
    at: Date;
    snap: { id: string; rateDecimal: Prisma.Decimal } | null;
  }): FxConversionResult {
    if (!params.snap) {
      return {
        ok: false,
        conversionUnavailable: true,
        reason: `No FX snapshot for ${params.baseCurrency}→USD at or before ${params.at.toISOString()}`,
      };
    }
    const rate = Number(params.snap.rateDecimal.toString());
    if (!Number.isFinite(rate) || rate <= 0) {
      return { ok: false, conversionUnavailable: true, reason: 'Invalid rate in snapshot' };
    }
    const baseExp = getIso4217MinorExponent(params.baseCurrency);
    const usdExp = USD_MINOR_EXPONENT;
    const baseMajor = params.amountMinor / 10 ** baseExp;
    const usdMajor = baseMajor * rate;
    const usdMinor = Math.round(usdMajor * 10 ** usdExp);
    return {
      ok: true,
      usdMinor,
      snapshotId: params.snap.id,
      rateDecimal: params.snap.rateDecimal.toString(),
    };
  }

  /**
   * Convierte usando snapshots ya cargados (p. ej. batch por moneda); misma semántica que {@link convertMinorToUsdSnapshot}.
   */
  convertMinorToUsdWithPreloadedUsdSnapshots(params: {
    amountMinor: number;
    currency: string;
    at: Date;
    usdSnapshotsByBase: Map<string, { id: string; rateDecimal: Prisma.Decimal }>;
  }): FxConversionResult {
    const cur = params.currency.toUpperCase();
    if (cur === 'USD') {
      return {
        ok: true,
        usdMinor: params.amountMinor,
        snapshotId: 'n/a-usd',
        rateDecimal: '1',
      };
    }
    const snap = params.usdSnapshotsByBase.get(cur) ?? null;
    return this.finalizeMinorToUsdFromLoadedNonUsdSnapshot({
      amountMinor: params.amountMinor,
      baseCurrency: cur,
      at: params.at,
      snap,
    });
  }

  /**
   * Convierte importe en unidades menores de `currency` a USD minor usando snapshot persistido.
   * Política MVP: si `currency` === USD, sin conversión; si no hay snapshot, `conversionUnavailable`.
   */
  async convertMinorToUsdSnapshot(params: {
    amountMinor: number;
    currency: string;
    at: Date;
  }): Promise<FxConversionResult> {
    const cur = params.currency.toUpperCase();
    if (cur === 'USD') {
      return {
        ok: true,
        usdMinor: params.amountMinor,
        snapshotId: 'n/a-usd',
        rateDecimal: '1',
      };
    }
    const snap = await this.getSnapshotAtOrBefore(cur, 'USD', params.at);
    return this.finalizeMinorToUsdFromLoadedNonUsdSnapshot({
      amountMinor: params.amountMinor,
      baseCurrency: cur,
      at: params.at,
      snap,
    });
  }

  async listRecentSnapshots(limit = 20) {
    return this.prisma.fxRateSnapshot.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  assertFxEnabled(): void {
    if (this.config.get<string>('FX_ENABLED') !== 'true') {
      throw new BadRequestException('FX is disabled');
    }
  }
}
