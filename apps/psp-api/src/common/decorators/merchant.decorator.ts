import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { MERCHANT_KEY } from '../guards/api-key.guard';

export const CurrentMerchant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): { id: string; name: string } => {
    const req = ctx.switchToHttp().getRequest<{ [MERCHANT_KEY]?: { id: string; name: string } }>();
    const m = req[MERCHANT_KEY];
    if (!m) {
      throw new Error('Merchant not set on request');
    }
    return m;
  },
);
