import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FxProviderClient } from './fx-provider.client';

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
    if (!snap) {
      return {
        ok: false,
        conversionUnavailable: true,
        reason: `No FX snapshot for ${cur}→USD at or before ${params.at.toISOString()}`,
      };
    }
    const rate = Number(snap.rateDecimal.toString());
    if (!Number.isFinite(rate) || rate <= 0) {
      return { ok: false, conversionUnavailable: true, reason: 'Invalid rate in snapshot' };
    }
    const usdMinor = Math.round(params.amountMinor * rate);
    return {
      ok: true,
      usdMinor,
      snapshotId: snap.id,
      rateDecimal: snap.rateDecimal.toString(),
    };
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
