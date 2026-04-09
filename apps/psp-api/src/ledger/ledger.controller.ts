import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentMerchant } from '../common/decorators/merchant.decorator';
import { LedgerService } from './ledger.service';

@ApiTags('ledger')
@Controller({ path: 'balance', version: '1' })
@UseGuards(ApiKeyGuard)
@ApiSecurity('ApiKey')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @ApiOperation({ summary: 'Saldos disponibles por moneda (derivados del ledger)' })
  getBalance(@CurrentMerchant() merchant: { id: string }) {
    return this.ledger.getBalances(merchant.id);
  }
}
