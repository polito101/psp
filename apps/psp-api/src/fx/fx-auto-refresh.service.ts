import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FxRatesService } from './fx-rates.service';

const EUR = 'EUR';
const USD = 'USD';

/**
 * Crea/actualiza snapshots EUR→USD sin intervención manual:
 * - al arranque, si aún no hay snapshot (p. ej. DB nueva en sandbox);
 * - de forma periódica, para alinear con tipos de mercado.
 */
@Injectable()
export class FxAutoRefreshService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FxAutoRefreshService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly fx: FxRatesService,
  ) {}

  isAutoRefreshEnabled(): boolean {
    if (this.config.get<string>('FX_ENABLED') !== 'true') {
      return false;
    }
    if (this.config.get<string>('FX_AUTO_REFRESH_ENABLED') !== 'true') {
      return false;
    }
    return true;
  }

  get refreshIntervalMs(): number {
    const n = Number(this.config.get<string>('FX_AUTO_REFRESH_INTERVAL_MS') ?? 0);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  async onModuleInit(): Promise<void> {
    if (!this.isAutoRefreshEnabled()) {
      return;
    }
    const intervalMs = this.refreshIntervalMs;
    await this.ensureEurUsdSnapshot('startup', { fillWhenMissingOnly: true });
    if (intervalMs > 0) {
      this.interval = setInterval(() => {
        void this.ensureEurUsdSnapshot('interval', { fillWhenMissingOnly: false });
      }, intervalMs);
    }
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async ensureEurUsdSnapshot(
    source: 'startup' | 'interval',
    options: { fillWhenMissingOnly: boolean },
  ): Promise<void> {
    try {
      if (options.fillWhenMissingOnly) {
        const latest = await this.fx.getLatestSnapshot(EUR, USD);
        if (latest) {
          this.logger.debug(
            `FX: snapshot EUR→USD present (${String(latest.id).slice(0, 8)}), skip fill-when-missing fetch`,
          );
          return;
        }
      }
      this.fx.assertFxEnabled();
      const out = await this.fx.refreshAndPersistSnapshot({
        baseCurrency: EUR,
        quoteCurrency: USD,
      });
      this.logger.log(
        `FX: persisted EUR→USD snapshot (${out.id}, effectiveAt=${out.effectiveAt.toISOString()}) [${source}]`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `FX: auto-refresh [${source}] no pudo persistir (dashboard USD puede faltar). ${message}`,
      );
    }
  }
}
