import { Module } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { SettlementRequestsService } from './settlement-requests.service';
import { SettlementsController } from './settlements.controller';

@Module({
  controllers: [SettlementsController],
  providers: [SettlementService, SettlementRequestsService],
  exports: [SettlementService, SettlementRequestsService],
})
export class SettlementsModule {}
