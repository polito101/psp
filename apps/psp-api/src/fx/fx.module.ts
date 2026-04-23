import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FxAutoRefreshService } from './fx-auto-refresh.service';
import { FxProviderClient } from './fx-provider.client';
import { FxRatesController } from './fx-rates.controller';
import { FxRatesService } from './fx-rates.service';

@Module({
  imports: [PrismaModule],
  controllers: [FxRatesController],
  providers: [FxRatesService, FxProviderClient, FxAutoRefreshService],
  exports: [FxRatesService],
})
export class FxModule {}
