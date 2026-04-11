import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller({ path: 'webhooks', version: '1' })
@ApiSecurity('InternalSecret')
@UseGuards(InternalSecretGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('deliveries/:id/retry')
  @ApiOperation({
    summary:
      'Reencolar entrega fallida o atascada en processing (operación interna, X-Internal-Secret)',
  })
  retryFailed(@Param('id') id: string) {
    return this.webhooks.retryFailedDelivery(id);
  }
}

