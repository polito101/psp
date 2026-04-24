import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { FxRatesService } from './fx-rates.service';

@ApiTags('fx')
@Controller({ path: 'fx', version: '1' })
@ApiSecurity('InternalSecret')
@UseGuards(InternalSecretGuard)
export class FxRatesController {
  constructor(private readonly fx: FxRatesService) {}

  @Get('snapshots/latest')
  @ApiOperation({ summary: 'Último snapshot FX persistido (interno)' })
  async latest(
    @Query('base') baseRaw?: string,
    @Query('quote') quoteRaw?: string,
  ) {
    const base = (baseRaw ?? 'EUR').toUpperCase().slice(0, 8);
    const quote = (quoteRaw ?? 'USD').toUpperCase().slice(0, 8);
    const row = await this.fx.getLatestSnapshot(base, quote);
    return { item: row };
  }

  @Get('snapshots/recent')
  @ApiOperation({ summary: 'Snapshots recientes (interno)' })
  async recent() {
    const items = await this.fx.listRecentSnapshots(30);
    return { items };
  }

  @Post('snapshots/refresh')
  @ApiOperation({ summary: 'Refrescar EUR→USD desde proveedor externo y persistir snapshot' })
  async refresh() {
    this.fx.assertFxEnabled();
    const created = await this.fx.refreshAndPersistSnapshot({
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
    });
    return { ok: true, ...created };
  }
}
